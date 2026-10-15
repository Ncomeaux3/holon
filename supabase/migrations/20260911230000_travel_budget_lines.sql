-- A trip's budget by category, as the trip drawer's Budget tab has it: a
-- planned figure per line that the owner types, an actual that is summed from
-- the trip's confirmed itinerary by kind unless typed over. trip.budget_cents
-- stays as the planned total.
--
-- Also the previous loyalty balance, so the strip's delta is a fact from the
-- second balance the owner enters, and nothing before.

create table travel.budget_line (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references travel.trip (id) on delete cascade,
  category text not null,
  planned_cents bigint not null default 0 check (planned_cents >= 0),
  actual_override_cents bigint check (actual_override_cents >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, category)
);
create index budget_line_trip_idx on travel.budget_line (trip_id, position);

create trigger set_updated_at before update on travel.budget_line
  for each row execute function core.set_updated_at();
alter table travel.budget_line enable row level security;
create policy owner_all on travel.budget_line for all to authenticated using (true) with check (true);
create policy readonly_select on travel.budget_line for select to pos_readonly using (true);
grant select, insert, update, delete on travel.budget_line to authenticated;
grant all on travel.budget_line to service_role;
grant select on travel.budget_line to pos_readonly;

alter table travel.loyalty_program add column previous_balance integer;
