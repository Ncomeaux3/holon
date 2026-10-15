-- The weekly review's reminder (v1.2 phase 14). A rule like the others, so the
-- Notifications screen can mute or snooze it; core/review-schedule.ts queues
-- one in-app alert at the review day and time when `review_reminder` is on.
insert into core.notification_rules
  (module, key, label, trigger_text, channels, timing, lead_days, urgent, sample_title, sample_body, position)
values
  ('system', 'weekly_review', 'Weekly review',
   'The weekly review day and time arrives, unless the week is already closed',
   '{inapp}', 'immediate', 0, false,
   'Time for the weekly review', 'Sunday 18:00, week 42', 15)
on conflict (module, key) do nothing;
