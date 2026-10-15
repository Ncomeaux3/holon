-- Health. One of the two modules the design introduces that SPEC does not
-- describe, so the shape comes from the backend handoff document, with the
-- corrections the build plan lists: every table gains created_at, updated_at,
-- source and external_id with a unique on the pair, and there is no
-- health.digest, because core.digests already holds every module's digest.
--
-- One deliberate departure from the handoff. It gives health.vital a `weight_g`
-- metric, and fitness.body_metric already stores body weight. Two tables
-- holding the same number is two sources of truth and one of them is always
-- stale, so vitals here are clinical readings only: blood pressure, lipids,
-- glucose. Body weight is read from the Fitness module through the metric
-- registry when it is installed, and simply absent when it is not.

create schema if not exists health;

grant usage on schema health to authenticated, service_role, pos_readonly;
-- So health.query keeps working as this module adds tables.
alter default privileges in schema health grant select on tables to pos_readonly;

create table health.provider (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null default '',
  phone text not null default '',
  address text not null default '',
  notes text not null default '',
  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create table health.appointment (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid references health.provider (id) on delete set null,
  what text not null,
  starts_at timestamptz not null,
  location text not null default '',
  status text not null default 'confirmed'
    check (status in ('confirmed', 'held', 'done', 'cancelled')),
  -- Cents, like every other money column in this app.
  cost_estimate_cents integer,
  -- What to do beforehand: fast twelve hours, bring the referral. The thing
  -- that is useless the day after and vital the day before.
  prep text not null default '',
  notes text not null default '',
  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index appointment_starts_idx on health.appointment (starts_at);

create table health.record (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid references health.appointment (id) on delete set null,
  title text not null,
  kind text not null default 'visit'
    check (kind in ('lab', 'visit', 'imaging', 'dental', 'vision', 'immunisation')),
  taken_on date not null,
  summary text not null default '',
  -- Whatever the document carried, as written. Not parsed into columns: a lab
  -- panel has forty analytes and every provider names them differently, and a
  -- schema that tried to hold them all would be wrong for the next one.
  fields jsonb not null default '{}'::jsonb,
  -- Path in the private `health` bucket. Signed URLs only, never public.
  file_path text,
  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index record_taken_idx on health.record (taken_on desc);

create table health.medication (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  dose text not null default '',
  schedule text not null default '',
  started_on date,
  ended_on date,
  refill_on date,
  notes text not null default '',
  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create table health.medication_log (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null references health.medication (id) on delete cascade,
  taken_on date not null,
  taken_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One mark per medication per day. Pressing it twice is a correction, not a
  -- second dose, and a schema that allowed both would make the streak a lie.
  unique (medication_id, taken_on)
);

create table health.vital (
  id uuid primary key default gen_random_uuid(),
  -- Clinical readings only. Body weight, resting heart rate and sleep live in
  -- fitness.body_metric and are read from there; see the note at the top.
  metric text not null
    check (metric in ('blood_pressure', 'ldl', 'hdl', 'triglycerides', 'a1c',
                      'glucose', 'vitamin_d', 'tsh')),
  value numeric not null,
  -- '118/74' lives here. Blood pressure is two numbers and one of them is not
  -- the reading.
  value_text text not null default '',
  measured_at timestamptz not null,
  -- lab | device | manual. Which is what decides whether a number is worth
  -- acting on, so it is required rather than nullable.
  provenance text not null default 'manual'
    check (provenance in ('lab', 'device', 'manual')),
  is_manual boolean not null default false,
  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (metric, measured_at, provenance)
);

create index vital_metric_idx on health.vital (metric, measured_at desc);

create table health.screening (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  interval_months integer not null check (interval_months > 0),
  last_done_on date,
  -- Snoozing is not dismissing. A screening comes back.
  snooze_until date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array['provider', 'appointment', 'record', 'medication',
                           'medication_log', 'vital', 'screening']
  loop
    execute format(
      'create trigger set_updated_at before update on health.%I
       for each row execute function core.set_updated_at()', t);

    execute format('alter table health.%I enable row level security', t);

    execute format(
      'create policy owner_all on health.%I for all to authenticated
       using (true) with check (true)', t);

    execute format(
      'create policy readonly_select on health.%I for select to pos_readonly using (true)', t);

    execute format('grant select, insert, update, delete on health.%I to authenticated', t);
    execute format('grant all on health.%I to service_role', t);
    execute format('grant select on health.%I to pos_readonly', t);
  end loop;
end;
$$;

-- Going to the appointment is the work. Recording a reading is not, and taking
-- a pill you are supposed to take every day should not pay XP for existing.
insert into skills.xp_weight (event_type, weight)
values ('appointment_attended', 15), ('screening_done', 30),
       ('vital_logged', 0), ('medication_taken', 0)
on conflict (event_type) do nothing;
