-- What the nightly sender and the dashboard's warnings tile need on top of the
-- original four columns: whether an alert is urgent, whether it has been read,
-- whether it is snoozed, and which run bundled it.
--
-- core.notification_rules and core.reviews are deliberately not here. They
-- belong to the Notifications and Weekly Review screens, and neither exists
-- yet: a table nothing writes is a table nobody maintains.

alter table core.notifications
  -- 'urgent' is the only thing allowed to break quiet hours, once quiet hours
  -- exist. Until then it sorts first in the digest.
  add column urgency text not null default 'normal'
    check (urgency in ('normal', 'urgent')),

  -- Null means unread. The warnings tile counts these, and Mark all read is one
  -- update.
  add column read_at timestamptz,

  -- Snoozing an alert is not dismissing it: it comes back.
  add column snooze_until timestamptz,

  -- Which nightly run put this in an email, so a digest can be reconstructed.
  add column digest_run_id uuid references core.job_runs (id) on delete set null;

create index notifications_unread_idx on core.notifications (due_at desc) where read_at is null;
