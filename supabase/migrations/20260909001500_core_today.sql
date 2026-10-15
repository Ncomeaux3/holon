-- One clock.
--
-- current_date is the database's day, and the database runs in UTC. The app's
-- day is the owner's, from core.settings.timezone. Between 19:00 in Chicago and
-- midnight in London those are different dates, so a task seeded as "due today"
-- landed on tomorrow's column and the digest counted the wrong day's work.
--
-- Every module that asks what day it is asks this, and core/today.ts reads the
-- same function rather than computing its own answer from the Node clock.
create or replace function core.today() returns date
language sql
stable
as $$
  select (now() at time zone coalesce(
    (select value #>> '{}' from core.settings where key = 'timezone'),
    'UTC'
  ))::date;
$$;

grant execute on function core.today() to authenticated, service_role, pos_readonly;
