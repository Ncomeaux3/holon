-- Idea research: the rubric run, its sources, and what it cost.
--
-- SPEC section 2. Every number in a report needs a cited source or it is not
-- written, so a claim and the URL behind it are stored together and a claim
-- whose source is not in the search results is dropped before it is saved.
--
-- Web search is billed on top of tokens: $10 per 1,000 searches, verified
-- 2026-09-09 against platform.claude.com. That is a cent a search, which is why
-- the count is stored per run and per call rather than folded into a number
-- nobody can take apart.

alter table core.llm_calls
  add column web_searches integer not null default 0;

comment on column core.llm_calls.web_searches is
  'Server-side web searches billed with this call. A cent each, included in cost_cents.';

create table ideas.research (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references ideas.idea (id) on delete cascade,

  -- Quick is the default per the 2026-09-05 decision. Deep is the same rubric
  -- with a larger search budget, not a different set of questions.
  depth text not null default 'quick' check (depth in ('quick', 'deep')),
  status text not null default 'ok' check (status in ('ok', 'failed')),

  -- The rubric's own verdict, in its words, plus how sure it says it is.
  verdict text not null default '',
  confidence numeric check (confidence >= 0 and confidence <= 1),

  -- One object per rubric section: problem, market, competitors,
  -- differentiation, feasibility. jsonb because the sections are prose plus a
  -- list of claims, and a table of claims would be five joins for one screen
  -- that always reads the whole thing at once.
  sections jsonb not null default '[]'::jsonb,

  -- Every URL the search actually returned. A claim citing anything not in
  -- here was dropped before this row was written.
  sources jsonb not null default '[]'::jsonb,

  -- What the run cost, kept apart so the screen can say "4 searches, 9 cents"
  -- rather than one number nobody can check.
  searches integer not null default 0 check (searches >= 0),
  cost_cents numeric not null default 0,
  model text not null default '',
  /** Empty unless status is failed, and then it is the reason. */
  detail text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index research_idea_idx on ideas.research (idea_id, created_at desc);

do $$
begin
  create trigger set_updated_at before update on ideas.research
    for each row execute function core.set_updated_at();

  alter table ideas.research enable row level security;

  create policy owner_all on ideas.research for all to authenticated
    using (true) with check (true);

  create policy readonly_select on ideas.research for select to pos_readonly using (true);

  grant select, insert, update, delete on ideas.research to authenticated;
  grant all on ideas.research to service_role;
  grant select on ideas.research to pos_readonly;
end;
$$;

-- Reading a market and writing down what you found is research work. The
-- model doing the reading is not, which is why the weight sits on the idea
-- being researched rather than on every claim it produced.
insert into skills.xp_weight (event_type, weight)
values ('idea_researched', 6)
on conflict (event_type) do nothing;
