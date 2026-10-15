-- Home and assets.
--
-- The house, the vehicles and the equipment worth tracking: what each is worth,
-- what it costs to keep, and what it needs next.
--
-- Maintenance is stored as an interval plus the date it was last done, not as a
-- list of future dates. A row of dates goes stale the moment a job is done
-- early or late, and reconciling it means either rewriting the future or living
-- with a calendar that disagrees with the history. Interval plus last done can
-- only be wrong about one thing at a time, and the next twelve months are
-- derived from it on read.

create schema if not exists home;

grant usage on schema home to authenticated, service_role, pos_readonly;
-- So home.query keeps working as this module adds tables.
alter default privileges in schema home grant select on tables to pos_readonly;

create table home.vendor (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Free text on purpose. "HVAC", "roofing", "the guy who did the fence".
  trade text not null default '',
  contact text not null default '',
  notes text not null default '',
  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create table home.asset (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('property', 'vehicle', 'equipment')),
  name text not null,
  -- The grey line under the name: mileage, square footage, how long owned.
  subtitle text not null default '',

  -- What it is worth and what a year of keeping it costs. Both are the owner's
  -- own estimate, entered by hand, and neither is a market quote. Nothing in
  -- this module fetches a valuation: there is no free API that would be right
  -- about this house, and a wrong number carried into net worth is worse than
  -- no number.
  value_cents bigint not null default 0 check (value_cents >= 0),
  annual_cost_cents bigint not null default 0 check (annual_cost_cents >= 0),
  value_as_of date,

  acquired_on date,
  notes text not null default '',

  -- The drawer's key and value rows: roof age, tyre tread, warranty registered.
  -- Free-form because every kind of asset has different ones, and a column per
  -- fact would be a schema change every time something new is worth writing
  -- down. Display only, and nothing computes against it.
  facts jsonb not null default '[]'::jsonb,

  archived boolean not null default false,
  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index asset_kind_idx on home.asset (kind, name);

-- A recurring job: gutters yearly, HVAC twice a year, oil every six months.
create table home.service (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references home.asset (id) on delete cascade,
  title text not null,
  vendor_id uuid references home.vendor (id) on delete set null,

  -- Months between one and the next. Zero means a one-off with a date.
  interval_months integer not null default 12
    check (interval_months >= 0 and interval_months <= 120),
  last_done_on date,
  -- Set for a one-off, or to override the interval for the next one only.
  due_on date,

  -- The owner's estimate of what it costs. Used for the calendar total, which
  -- is labelled an estimate everywhere it appears.
  cost_estimate_cents integer not null default 0 check (cost_estimate_cents >= 0),

  snooze_until date,
  notes text not null default '',
  active boolean not null default true,

  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index service_asset_idx on home.service (asset_id, active);

-- What was actually done, and what it actually cost. Append only in practice:
-- history is the point of the table.
create table home.service_log (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references home.asset (id) on delete cascade,
  -- Null for something done once that was never on a schedule.
  service_id uuid references home.service (id) on delete set null,
  vendor_id uuid references home.vendor (id) on delete set null,

  what text not null,
  done_on date not null,
  -- Null when it cost nothing or the receipt is not to hand. Zero is a claim
  -- that it was free, which is a different thing from not knowing.
  cost_cents integer check (cost_cents >= 0),
  notes text not null default '',

  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index service_log_asset_idx on home.service_log (asset_id, done_on desc);

create table home.warranty (
  id uuid primary key default gen_random_uuid(),
  -- Null for a document that belongs to no single asset, like a deed.
  asset_id uuid references home.asset (id) on delete set null,
  name text not null,
  detail text not null default '',
  -- "10 YR PARTS", "5 YR TOOL", "DOCUMENTS". What is covered, in the words on
  -- the paperwork.
  cover text not null default '',
  -- Null means it does not expire, which is a real state for a deed or a
  -- survey and not the same as an unknown date.
  expires_on date,
  document_url text not null default '',
  facts jsonb not null default '[]'::jsonb,

  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index warranty_expires_idx on home.warranty (expires_on);

do $$
declare
  t text;
begin
  foreach t in array array['vendor', 'asset', 'service', 'service_log', 'warranty']
  loop
    execute format(
      'create trigger set_updated_at before update on home.%I
       for each row execute function core.set_updated_at()', t);

    execute format('alter table home.%I enable row level security', t);

    execute format(
      'create policy owner_all on home.%I for all to authenticated
       using (true) with check (true)', t);

    execute format(
      'create policy readonly_select on home.%I for select to pos_readonly using (true)', t);

    execute format('grant select, insert, update, delete on home.%I to authenticated', t);
    execute format('grant all on home.%I to service_role', t);
    execute format('grant select on home.%I to pos_readonly', t);
  end loop;
end;
$$;

-- Doing the job yourself is Life ops work. Paying someone to do it is not, and
-- the log does not know which happened, so the weight is small either way.
insert into skills.xp_weight (event_type, weight)
values ('service_logged', 4), ('asset_added', 2)
on conflict (event_type) do nothing;
