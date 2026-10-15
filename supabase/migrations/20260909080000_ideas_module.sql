-- Ideas.
--
-- SPEC describes a research job with a fixed rubric, web search, and a rule
-- that every number needs a cited source or it is not written. The design shows
-- only the board, and decision 9 keeps features the design omits as a follow-on
-- pass per module, so the research pass is not here yet. What is here is the
-- part the design does show, and it stores nothing a research job could not
-- later attach to.

create schema if not exists ideas;

grant usage on schema ideas to authenticated, service_role, pos_readonly;
-- So ideas.query keeps working as this module adds tables.
alter default privileges in schema ideas grant select on tables to pos_readonly;

create table ideas.idea (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  pitch text not null default '',
  notes text not null default '',

  -- exploring | validated | building | killed. Killed is kept rather than
  -- deleted: the reason you dropped something is the most useful note about it,
  -- and it is what stops the same idea arriving again in six months.
  stage text not null default 'exploring'
    check (stage in ('exploring', 'validated', 'building', 'killed')),

  -- 1 low, 2 medium, 3 high. A three point scale on purpose: the difference
  -- between a 6 and a 7 out of ten is not a judgement anyone can make
  -- consistently, and a scale that invites it produces false precision.
  effort integer not null default 2 check (effort between 1 and 3),
  impact integer not null default 2 check (impact between 1 and 3),

  -- Why it was killed. Only meaningful in that stage, and the reason the row
  -- is worth keeping.
  killed_reason text not null default '',

  -- The core registry row for a goal this would serve. Not a foreign key into
  -- another module's schema, and null until Goals exists.
  goal_ref uuid references core.entities (id) on delete set null,

  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index idea_stage_idx on ideas.idea (stage, updated_at desc);

do $$
begin
  -- Stamps the time unless the writer set updated_at itself. The demo seed
  -- back-dates a row so the "not moving" card has something in it, and an
  -- unconditional trigger would silently undo that on every re-seed.
  create trigger set_updated_at before update on ideas.idea
    for each row when (new.updated_at is not distinct from old.updated_at)
    execute function core.set_updated_at();

  alter table ideas.idea enable row level security;

  create policy owner_all on ideas.idea for all to authenticated
    using (true) with check (true);

  create policy readonly_select on ideas.idea for select to pos_readonly using (true);

  grant select, insert, update, delete on ideas.idea to authenticated;
  grant all on ideas.idea to service_role;
  grant select on ideas.idea to pos_readonly;
end;
$$;

-- Starting to build one is the event worth anything. Having an idea is not, or
-- the board would pay better than the work.
insert into skills.xp_weight (event_type, weight)
values ('idea_building', 20), ('idea_captured', 0), ('idea_killed', 0)
on conflict (event_type) do nothing;
