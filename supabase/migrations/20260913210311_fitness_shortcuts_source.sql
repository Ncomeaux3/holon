-- A second Apple Health source: an iOS Shortcut posting a flat payload to
-- /api/integrations/apple_shortcuts/webhook, for an owner who does not want
-- to pay for Health Auto Export. Same tables, same manual guard, its own
-- source value so a row says which phone automation wrote it.

alter table fitness.workout drop constraint workout_source_check;
alter table fitness.workout add constraint workout_source_check check (
  source in ('manual', 'agent', 'strava', 'health_auto_export', 'apple_shortcuts', 'notion_import', 'demo')
);

alter table fitness.body_metric drop constraint body_metric_source_check;
alter table fitness.body_metric add constraint body_metric_source_check check (
  source in ('manual', 'agent', 'strava', 'health_auto_export', 'apple_shortcuts', 'notion_import', 'demo')
);
