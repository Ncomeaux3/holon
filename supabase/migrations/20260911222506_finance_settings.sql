-- Finance's own preferences, one row. The budget alert threshold was a constant
-- read in four places (the budget flags, the KPI cell, the digest's overBudget
-- and the dashboard headline's clause); the artboard's Budget limits drawer
-- ends with a slider for it, so it is a setting, and it lives here because it
-- is Finance's, not core's.

create table finance.settings (
  id boolean primary key default true check (id),
  alert_threshold int not null default 80 check (alert_threshold between 50 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into finance.settings default values;

create trigger set_updated_at before update on finance.settings
  for each row execute function core.set_updated_at();

alter table finance.settings enable row level security;
create policy owner_all on finance.settings for all to authenticated using (true) with check (true);
create policy readonly_select on finance.settings for select to pos_readonly using (true);
grant select, insert, update, delete on finance.settings to authenticated;
grant all on finance.settings to service_role;
grant select on finance.settings to pos_readonly;
