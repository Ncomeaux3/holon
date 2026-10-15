-- Reminders posted by the iOS Shortcut are tasks with their own source, so a
-- pull can find its own rows again through `unique (source, external_id)` and
-- nothing it writes is confused with a task typed here.

alter table tasks.task drop constraint task_source_check;

alter table tasks.task add constraint task_source_check
  check (source in ('manual', 'agent', 'apple_reminders', 'notion_import', 'demo'));
