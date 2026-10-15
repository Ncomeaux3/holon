-- An exercise is typed by hand now (v1.2 phase 8), so it carries what the
-- owner knows about it: the muscle group it works and how a set of it is
-- measured. `measure` decides what the set logger asks for; set_entry still
-- holds reps and weight only, so time and distance are labels until it can
-- store them.
alter table fitness.exercise
  add column muscle_group text not null default '',
  add column measure text not null default 'weight_reps'
    check (measure in ('weight_reps', 'reps', 'time', 'distance'));
