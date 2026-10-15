-- Eleven more body_metric kinds, the daily numbers Health Auto Export sends
-- besides the five the table opened with. Each is stored as an integer in one
-- unit, named in the comment, the way the first five are.
--
--   steps             count            active_energy     kcal
--   exercise_minutes  minutes          stand_hours       hours
--   vo2_max           tenths of mL/kg/min
--   blood_oxygen      tenths of a percent
--   respiratory_rate  tenths of breaths a minute
--   flights_climbed   count            walking_distance  metres
--   walking_hr_avg    bpm              heart_rate_avg    bpm

alter table fitness.body_metric drop constraint body_metric_kind_check;
alter table fitness.body_metric add constraint body_metric_kind_check check (
  kind in (
    'weight', 'resting_hr', 'hrv', 'sleep_minutes', 'body_fat',
    'steps', 'active_energy', 'exercise_minutes', 'stand_hours', 'vo2_max',
    'blood_oxygen', 'respiratory_rate', 'flights_climbed', 'walking_distance',
    'walking_hr_avg', 'heart_rate_avg'
  )
);
