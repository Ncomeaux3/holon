-- A trip holds several destinations.
--
-- One trip with four cities was four trips, because the only place a city
-- could live was trip.destination, which holds one. A destination now has its
-- own row with its own dates and coordinates, so the globe pins every city a
-- trip visits rather than the first one somebody typed.
--
-- The trip's own destination, lat, lon, starts_on and ends_on stay and become
-- the summary: the first destination and the span across all of them. Every
-- existing reader (the tile, the digest, the list, completeFinishedTrips) goes
-- on reading the columns it already reads.

create table travel.destination (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references travel.trip (id) on delete cascade,
  name text not null,

  -- Null is legal for the same reason it is on the trip: a city decided before
  -- anyone looked up where it is should not be pinned at 0,0 in the Atlantic.
  lat numeric(8, 5),
  lon numeric(8, 5),

  starts_on date,
  ends_on date,

  -- The order the owner put them in, which is the order they will be visited.
  -- Not derived from the dates: a destination can be added before its dates
  -- are known and still belong third.
  position integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint destination_dates_ordered check (
    starts_on is null or ends_on is null or ends_on >= starts_on
  )
);
create index destination_trip_idx on travel.destination (trip_id, position);

create trigger set_updated_at before update on travel.destination
  for each row execute function core.set_updated_at();
alter table travel.destination enable row level security;
create policy owner_all on travel.destination for all to authenticated using (true) with check (true);
create policy readonly_select on travel.destination for select to pos_readonly using (true);
grant select, insert, update, delete on travel.destination to authenticated;
grant all on travel.destination to service_role;
grant select on travel.destination to pos_readonly;

-- Every trip that names a place or knows where it is becomes a trip with one
-- destination. Copied, not moved: the trip columns stay as the summary, so the
-- pins, the digest and completeFinishedTrips all read one table from here
-- rather than each carrying a fallback for trips that predate this.
--
-- A trip with neither gets no row, which is correct: an idea on the wishlist
-- with no place yet has no destination to pin.
insert into travel.destination (trip_id, name, lat, lon, starts_on, ends_on, position)
select id, destination, lat, lon, starts_on, ends_on, 0
  from travel.trip
 where destination <> '' or lat is not null;
