-- The Notifications screen edits one row per rule. core.notifications already
-- holds the queued sends; this is the rule set behind them, plus the link from
-- a send back to the rule that produced it.
--
-- Digest batching is a property of the rule, not the sender: the sender groups
-- every unsent row whose rule has timing <> 'immediate' into that digest.
--
-- core_init configures core tables in a do block over pg_tables that does not
-- re-run for a later migration, so this repeats the five statements itself.

create table core.notification_rules (
  id uuid primary key default gen_random_uuid(),
  -- Which module owns it. 'system' for the runner's own alerts.
  module text not null,
  -- Stable identity within the module: 'statement_due', 'budget_pacing'.
  key text not null,
  label text not null,
  -- Shown in the UI so the rule explains itself. Never evaluated: the job that
  -- raises the alert is the thing that decides.
  trigger_text text not null,
  -- push | email | inapp. An empty array is legal and means nothing is sent,
  -- which the screen says out loud rather than silently dropping.
  channels text[] not null default '{inapp}',
  timing text not null default 'immediate'
    check (timing in ('immediate', 'morning', 'evening')),
  -- How far ahead of the event it fires. 0.5 is twelve hours, 14 is two weeks.
  lead_days numeric(5, 2) not null default 0,
  -- The only thing allowed through quiet hours, and only while the urgent
  -- override setting is on.
  urgent boolean not null default false,
  -- Muted is indefinite; snoozed comes back. Undo sets snooze_until seven days
  -- out on the rule that produced the write.
  muted boolean not null default false,
  snooze_until timestamptz,
  -- Two lines of realistic copy, used by the screen's push and email previews
  -- so a rule can be judged before it ever fires.
  sample_title text not null default '',
  sample_body text not null default '',
  -- Ordering in the rules table. Positional, so a fork can reorder without
  -- renaming anything.
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (module, key)
);
create index notification_rules_module_idx on core.notification_rules (module, position);

-- Which rule queued a notification, so the alert centre can group by rule and
-- Undo can pause the rule that caused a write.
alter table core.notifications
  add column rule_id uuid references core.notification_rules (id) on delete set null;

-- The fourteen rules the design ships with. A fork gets a working notification
-- set on first load instead of an empty table it has to invent.
insert into core.notification_rules
  (module, key, label, trigger_text, channels, timing, lead_days, urgent, sample_title, sample_body, position)
values
  ('finance', 'statement_due', 'Statement due',
   'A credit card statement is due and autopay is off',
   '{push,email,inapp}', 'immediate', 3, true,
   'Northwind Rewards card due in 3 days', '$1,374 statement, autopay is off', 1),

  ('finance', 'budget_pacing', 'Budget pacing',
   'A category passes 90% of its monthly cap',
   '{email,inapp}', 'morning', 0, false,
   'Dining budget at 92%', '$38 left with 19 days to go', 2),

  ('finance', 'large_charge', 'Large charge',
   'A single charge clears above $500',
   '{push,inapp}', 'immediate', 0, false,
   'ABC Plumbing, $860', 'Cleared on Checking 3318, filed under Home', 3),

  ('tasks', 'today_plan', 'Today plan',
   'Morning list of everything due today',
   '{push,email,inapp}', 'morning', 0, false,
   '4 tasks today, 2h 10m planned', 'Capacity plan, insurance call, redlines, zone 2 run', 4),

  ('tasks', 'task_reminder', 'Task reminder',
   'A task with a set time is coming up',
   '{push,inapp}', 'immediate', 0.5, false,
   'Call Keystone Auto in 30 minutes', 'Umbrella policy, quote reference on the Insurance page', 5),

  ('tasks', 'overdue_sweep', 'Overdue sweep',
   'Anything still open past its due date',
   '{inapp}', 'evening', 0, false,
   '2 tasks slipped today', 'Both rolled to tomorrow unless you move them', 6),

  ('goals', 'goal_stalled', 'Goal stalled',
   'No measurable change on a goal for 60 days',
   '{email,inapp}', 'evening', 0, false,
   'Sub-24 5K has not moved in 63 days', 'Last check-in 6 Jul, pace 38% of plan', 7),

  ('goals', 'pace_at_risk', 'Pace at risk',
   'Projected finish slips past the target date',
   '{push,email,inapp}', 'morning', 0, false,
   'Ship POS v1 projects to 12 Nov', 'Three weeks past target at the current pace', 8),

  ('insurance', 'policy_renewal', 'Policy renewal',
   'A policy renews or lapses soon',
   '{push,email,inapp}', 'immediate', 14, true,
   'Landlord policy renews 14 Nov', 'Premium up 6%, $1,152 for the year', 9),

  ('insurance', 'premium_change', 'Premium change',
   'A carrier changes the premium at renewal',
   '{email,inapp}', 'morning', 0, false,
   'Auto premium up $18/mo', 'Effective 1 Oct, worth a comparison quote', 10),

  ('travel', 'flight_checkin', 'Flight check-in',
   'Check-in opens for a booked flight',
   '{push,inapp}', 'immediate', 1, true,
   'Check in for WN 2087', 'RDU to SLC, 07:40 tomorrow, seats not selected', 11),

  ('travel', 'trip_budget', 'Trip budget',
   'A trip crosses its budget',
   '{email,inapp}', 'evening', 0, false,
   'Salt Lake City weekend at 88% of budget', '$1,672 of $1,900 committed, lift tickets still open', 12),

  ('system', 'job_failed', 'Nightly job failed',
   'A scheduled ingest or sync fails twice',
   '{push,email,inapp}', 'immediate', 0, true,
   'Harbor Investments sync failed twice', 'Last good pull 3 Nov 04:00, balances may be stale', 13),

  ('system', 'backup_summary', 'Backup summary',
   'Nightly backup finishes',
   '{inapp}', 'evening', 0, false,
   'Backup complete, 30 snapshots kept', '04:10, 1.4 GB, no integrity warnings', 14);

do $$
begin
  create trigger set_updated_at before update on core.notification_rules
    for each row execute function core.set_updated_at();

  alter table core.notification_rules enable row level security;

  create policy owner_all on core.notification_rules for all to authenticated
    using (true) with check (true);

  create policy readonly_select on core.notification_rules for select to pos_readonly
    using (true);

  grant select, insert, update, delete on core.notification_rules to authenticated;
  grant all on core.notification_rules to service_role;
  grant select on core.notification_rules to pos_readonly;
end;
$$;
