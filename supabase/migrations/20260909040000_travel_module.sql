-- Travel.
--
-- SPEC is explicit that loyalty sites are not scraped. Every balance here is a
-- number the owner typed, and the one calculation the module offers, cents per
-- point, divides two numbers they supplied. Nothing guesses what a point is
-- worth, because nothing here can know.

create schema if not exists travel;

grant usage on schema travel to authenticated, service_role, pos_readonly;
-- So travel.query keeps working as this module adds tables.
alter default privileges in schema travel grant select on tables to pos_readonly;

create table travel.trip (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  destination text not null default '',

  -- Where it is, for the globe. Null is legal: a trip can be planned before
  -- anyone has decided where, and a dot at 0,0 in the Atlantic would be worse
  -- than no dot.
  lat numeric(8, 5),
  lon numeric(8, 5),

  starts_on date,
  ends_on date,

  -- Cents, like every other money column in this app.
  budget_cents bigint not null default 0,
  travellers integer not null default 1 check (travellers > 0),

  -- idea | planned | booked | done. An idea is the wishlist; it has no dates
  -- and is not counted against anything.
  status text not null default 'idea'
    check (status in ('idea', 'planned', 'booked', 'done')),
  notes text not null default '',

  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id),

  -- A trip cannot end before it starts. Cheap, and it catches a transposed
  -- pair of dates at the point of entry rather than in a negative duration
  -- three screens away.
  constraint trip_dates_ordered check (
    starts_on is null or ends_on is null or ends_on >= starts_on
  )
);

create index trip_status_idx on travel.trip (status, starts_on);

create table travel.itinerary_item (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references travel.trip (id) on delete cascade,

  -- flight | lodging | transit | activity | food
  kind text not null default 'activity'
    check (kind in ('flight', 'lodging', 'transit', 'activity', 'food')),
  title text not null,
  detail text not null default '',

  occurs_on date,
  occurs_at time,

  amount_cents bigint not null default 0,
  confirmation text not null default '',

  -- pending: parsed from a booking email and waiting to be accepted.
  -- Same review shape as the Second Brain inbox, for the same reason: a
  -- machine reading a confirmation is proposing, not deciding.
  status text not null default 'confirmed' check (status in ('pending', 'confirmed')),
  /** How sure the parse was. Null when a person entered it. */
  confidence numeric check (confidence is null or confidence between 0 and 1),

  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index itinerary_trip_idx on travel.itinerary_item (trip_id, occurs_on, occurs_at);

-- The packing list. A table rather than a jsonb column on the trip because the
-- one thing it does is get ticked off one row at a time.
create table travel.packing_item (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references travel.trip (id) on delete cascade,
  label text not null,
  packed boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index packing_trip_idx on travel.packing_item (trip_id, position);

-- Somewhere you have been, for the map. Separate from a trip because a trip can
-- visit several places and because a place outlives the trip that recorded it.
create table travel.place_visited (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references travel.trip (id) on delete set null,
  name text not null,
  country text not null default '',
  lat numeric(8, 5) not null,
  lon numeric(8, 5) not null,
  visited_on date,
  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

-- Balances the owner types. SPEC: no public API exists for these and none is
-- attempted, so `updated_at` is the honest measure of how stale a number is.
create table travel.loyalty_program (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- airline | hotel | card | rail
  kind text not null default 'airline' check (kind in ('airline', 'hotel', 'card', 'rail')),
  balance integer not null default 0,
  status_tier text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array['trip', 'itinerary_item', 'packing_item', 'place_visited',
                           'loyalty_program']
  loop
    execute format(
      'create trigger set_updated_at before update on travel.%I
       for each row execute function core.set_updated_at()', t);

    execute format('alter table travel.%I enable row level security', t);

    execute format(
      'create policy owner_all on travel.%I for all to authenticated
       using (true) with check (true)', t);

    execute format(
      'create policy readonly_select on travel.%I for select to pos_readonly using (true)', t);

    execute format('grant select, insert, update, delete on travel.%I to authenticated', t);
    execute format('grant all on travel.%I to service_role', t);
    execute format('grant select on travel.%I to pos_readonly', t);
  end loop;
end;
$$;

-- Taking a trip is worth something; planning one is not, or the wishlist would
-- pay better than going.
insert into skills.xp_weight (event_type, weight)
values ('trip_completed', 40), ('trip_created', 0), ('place_visited', 10)
on conflict (event_type) do nothing;
