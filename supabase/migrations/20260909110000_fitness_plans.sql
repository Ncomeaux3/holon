-- Fitness plans, and the coach that proposes changes to them.
--
-- SPEC section 3: "Coaching agent reads weekly digest and proposes plan
-- adjustments. Proposals only, user approves." Held to literally: the coach has
-- no unguarded write. Every suggestion it makes goes through the guarded
-- write_plan tool, which means core.proposals and the Review inbox, and the
-- plan does not change until the owner says so.
--
-- The rules the coach applies are deterministic and live in
-- modules/fitness/coach.ts with tests. No model call: a rule that says "you
-- jumped fifty percent in a week, back off" is not a judgement worth paying for
-- and not one that should vary between runs.

create table fitness.plan (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- What it is for, in the owner's words. Not a category and nothing reads it.
  goal text not null default '',
  days_per_week integer not null default 3
    check (days_per_week between 1 and 7),
  notes text not null default '',
  status text not null default 'active' check (status in ('active', 'archived')),
  started_on date,

  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index plan_status_idx on fitness.plan (status, started_on desc);

create table fitness.plan_item (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references fitness.plan (id) on delete cascade,

  -- 'Mon', 'Day 1', 'Push'. Free text, because a plan is not a calendar and
  -- pinning one to weekdays makes every missed Tuesday look like a failure.
  day_label text not null default '',

  -- A name, not a foreign key into fitness.exercise. A plan can name a lift you
  -- have never done, which is the normal case the day you write one.
  exercise text not null,
  sets integer not null default 3 check (sets > 0),
  -- '5', '8-12', 'AMRAP'. A number column would reject two of those three.
  reps text not null default '',
  -- Grams, like every other weight in this module. Null for bodyweight or for
  -- a lift where the plan does not say.
  target_weight_g bigint check (target_weight_g >= 0),
  notes text not null default '',
  position integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index plan_item_plan_idx on fitness.plan_item (plan_id, position);

do $$
declare
  t text;
begin
  foreach t in array array['plan', 'plan_item']
  loop
    execute format(
      'create trigger set_updated_at before update on fitness.%I
       for each row execute function core.set_updated_at()', t);

    execute format('alter table fitness.%I enable row level security', t);

    execute format(
      'create policy owner_all on fitness.%I for all to authenticated
       using (true) with check (true)', t);

    execute format(
      'create policy readonly_select on fitness.%I for select to pos_readonly using (true)', t);

    execute format('grant select, insert, update, delete on fitness.%I to authenticated', t);
    execute format('grant all on fitness.%I to service_role', t);
    execute format('grant select on fitness.%I to pos_readonly', t);
  end loop;
end;
$$;

-- Writing a plan is not training. Zero rather than absent, so it is a decision
-- on the record rather than a weight somebody forgot to add.
insert into skills.xp_weight (event_type, weight)
values ('plan_written', 0)
on conflict (event_type) do nothing;
