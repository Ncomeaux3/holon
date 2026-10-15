-- Every scalar Health Auto Export sends beyond the columns, in the app's units
-- (integrations/health_auto_export/client.ts, WorkoutStats). Nothing sorts or
-- filters by any of them, so they share one column; promote a key when a
-- filter wants it. Manual, agent, Shortcut and Strava workouts keep '{}'.
alter table fitness.workout add column stats jsonb not null default '{}';
