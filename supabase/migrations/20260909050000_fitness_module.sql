-- Fitness.
--
-- Two sources by decision: Strava for workouts, Apple Health via Health Auto
-- Export for body metrics. Both are optional; everything here can be entered by
-- hand, which is why the module page is not gated on either.
--
-- SPEC also asks for workout plans and a coaching agent. Decision 9 keeps
-- features the design omits as a follow-on pass per module, and the Fitness
-- screen has no plan UI, so there is no plan table here yet. A table nothing
-- writes is a table nobody maintains.

create schema if not exists fitness;

grant usage on schema fitness to authenticated, service_role, pos_readonly;
-- So fitness.query keeps working as this module adds tables.
alter default privileges in schema fitness grant select on tables to pos_readonly;

create table fitness.workout (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  detail text not null default '',

  -- strength | run | ride | swim | walk | other
  kind text not null default 'other'
    check (kind in ('strength', 'run', 'ride', 'swim', 'walk', 'other')),

  started_at timestamptz not null,
  duration_s integer not null default 0 check (duration_s >= 0),

  -- Metres and integers. Distance in kilometres as a float would make a
  -- fortnight of runs sum to something ending in 0.30000000000000004.
  distance_m integer not null default 0 check (distance_m >= 0),
  avg_hr integer check (avg_hr is null or avg_hr between 20 and 260),

  source text not null default 'manual'
    check (source in ('manual', 'agent', 'strava', 'health_auto_export', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index workout_started_idx on fitness.workout (started_at desc);

create table fitness.exercise (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table fitness.set_entry (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references fitness.workout (id) on delete cascade,
  exercise_id uuid not null references fitness.exercise (id) on delete cascade,

  reps integer not null check (reps > 0),
  -- Grams. Integer, and unit free at rest: pounds and kilograms are both a
  -- rendering decision, and storing either one makes the other lossy.
  weight_g integer not null default 0 check (weight_g >= 0),

  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index set_workout_idx on fitness.set_entry (workout_id, position);
create index set_exercise_idx on fitness.set_entry (exercise_id, weight_g desc);

create table fitness.body_metric (
  id uuid primary key default gen_random_uuid(),
  -- weight | resting_hr | hrv | sleep_minutes | body_fat
  kind text not null
    check (kind in ('weight', 'resting_hr', 'hrv', 'sleep_minutes', 'body_fat')),

  measured_on date not null,
  -- Grams for weight, beats for heart rate, minutes for sleep, tenths of a
  -- percent for body fat. One numeric column with a documented unit per kind
  -- rather than five nullable columns.
  value numeric not null,

  source text not null default 'manual'
    check (source in ('manual', 'agent', 'strava', 'health_auto_export', 'notion_import', 'demo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One reading per metric per day. A second is a correction, not a new point,
  -- the same rule the goals module uses and for the same reason.
  unique (kind, measured_on)
);

do $$
declare
  t text;
begin
  foreach t in array array['workout', 'exercise', 'set_entry', 'body_metric']
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

-- A workout is the small weight SPEC names for Health. A body measurement is
-- worth nothing: stepping on a scale is not training.
insert into skills.xp_weight (event_type, weight)
values ('workout_logged', 12), ('body_metric_logged', 0)
on conflict (event_type) do nothing;
