-- The Goals module. A goal is a target with a deadline; a check-in is one
-- reading of where it stands.
--
-- Nothing here computes progress. The status rules, the two projections and
-- the pace arithmetic live in modules/goals/progress.ts with their test,
-- because they are the part worth being able to change and re-verify without a
-- migration.

create schema if not exists goals;

grant usage on schema goals to authenticated, service_role, pos_readonly;
-- So goals.query keeps working as this module adds tables.
alter default privileges in schema goals grant select on tables to pos_readonly;

create table goals.goal (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text not null default '',

  -- Which part of life it belongs to. Free text rather than an enum: the areas
  -- come from the skill tree's top level, which a fork edits.
  area text not null default 'Life ops',

  -- number: a value to reach. count: a tally. streak: a weekly habit, never
  -- finished. milestone: it happened or it did not.
  kind text not null default 'number'
    check (kind in ('number', 'count', 'streak', 'milestone')),

  unit text not null default '',
  start_value numeric not null default 0,
  target_value numeric not null,
  deadline date not null,

  -- Which module metric computes this goal, as `<module>.<metric>`. Null means
  -- the owner checks in by hand. Resolved through the manifest's metric
  -- registry, never by parsing a query string or reaching into another schema.
  metric_source text,

  archived boolean not null default false,

  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (source, external_id)
);

create table goals.checkin (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals.goal (id) on delete cascade,
  value numeric not null,
  note text not null default '',

  -- The day the reading is for, which is not always the day it was entered.
  occurred_on date not null default core.today(),

  -- A hand entered check-in on a computed goal overrules the computation, and
  -- the nightly job never overwrites it.
  is_manual boolean not null default true,

  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One reading per goal per day. A second check-in on the same day is a
  -- correction, not a new data point, and the pace maths would double count it.
  unique (goal_id, occurred_on)
);

create index checkin_goal_idx on goals.checkin (goal_id, occurred_on desc);
create index goal_open_idx on goals.goal (deadline) where archived = false;

do $$
declare
  t text;
begin
  foreach t in array array['goal', 'checkin']
  loop
    execute format(
      'create trigger set_updated_at before update on goals.%I
       for each row execute function core.set_updated_at()', t);

    execute format('alter table goals.%I enable row level security', t);

    execute format(
      'create policy owner_all on goals.%I for all to authenticated
       using (true) with check (true)', t);

    execute format(
      'create policy readonly_select on goals.%I for select to pos_readonly using (true)', t);

    execute format('grant select, insert, update, delete on goals.%I to authenticated', t);
    execute format('grant all on goals.%I to service_role', t);
    execute format('grant select on goals.%I to pos_readonly', t);
  end loop;
end;
$$;

-- Reaching a goal is the largest single event the XP model has. Creating one is
-- worth nothing: writing down an intention is not the work.
insert into skills.xp_weight (event_type, weight)
values ('goal_reached', 120), ('goal_created', 0), ('goal_checkin', 2)
on conflict (event_type) do nothing;
