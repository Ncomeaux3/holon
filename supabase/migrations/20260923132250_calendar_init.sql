-- Calendar.
--
-- Everything dated in POS already lives in its own module and reaches the
-- Calendar through the manifest's `calendar` seam, so nothing here copies it.
-- This schema holds only what has no other home: events typed by the owner and,
-- from v1.2 Phases 7a and 7b, events pulled read-only from Google and iCloud.

create schema if not exists calendar;

grant usage on schema calendar to authenticated, service_role, pos_readonly;
alter default privileges in schema calendar grant select on tables to pos_readonly;

create table calendar.event (
  id uuid primary key default gen_random_uuid(),
  -- 'google' and 'ics' are the feeds the v1.2 plan adds; listed now so those
  -- phases need no migration to widen the check.
  source text not null default 'manual'
    check (source in ('manual', 'agent', 'google', 'ics', 'notion_import', 'demo')),
  external_id text,
  -- The feed's own calendar name ("Work", "Family"). Empty for a typed event.
  calendar_name text not null default '',
  title text not null check (length(title) between 1 and 200),
  starts_at timestamptz not null,
  ends_at timestamptz,
  -- An all-day event stores midnight in the owner's zone and is read by date.
  all_day boolean not null default false,
  location text not null default '',
  url text not null default '',
  -- The feed's payload as received, for a pull to diff against. Null when typed.
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id),
  check (ends_at is null or ends_at >= starts_at)
);

create index event_starts_idx on calendar.event (starts_at);

-- Which modules the owner has switched off on the screen. One row, like
-- finance.settings, so the choice follows the owner between phone and desktop.
create table calendar.settings (
  id boolean primary key default true check (id),
  hidden text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into calendar.settings default values;

do $$
declare
  t text;
begin
  foreach t in array array['event', 'settings']
  loop
    execute format(
      'create trigger set_updated_at before update on calendar.%I
       for each row execute function core.set_updated_at()', t);

    execute format('alter table calendar.%I enable row level security', t);

    execute format(
      'create policy owner_all on calendar.%I for all to authenticated
       using (true) with check (true)', t);

    execute format(
      'create policy readonly_select on calendar.%I for select to pos_readonly using (true)', t);

    execute format('grant select, insert, update, delete on calendar.%I to authenticated', t);
    execute format('grant all on calendar.%I to service_role', t);
    execute format('grant select on calendar.%I to pos_readonly', t);
  end loop;
end;
$$;

-- An owner who finished Onboarding has `modules_enabled` as an explicit list,
-- and a module missing from it is hidden from the rail and the phone tab bar.
-- The v1.2 plan puts Calendar in the tab bar, so it arrives switched on;
-- Onboarding switches it off like any other. null means every module already.
update core.settings
   set value = value || '["calendar"]'::jsonb
 where key = 'modules_enabled'
   and jsonb_typeof(value) = 'array'
   and not value ? 'calendar';
