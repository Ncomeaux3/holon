-- Workout distance to the centimetre. Whole metres lost a yard on a pool
-- swim (275 yd is 251.46 m, stored as 251 and read back as 274 yd); every
-- source sends a decimal distance, so the column keeps two places.
alter table fitness.workout
  alter column distance_m type numeric(10,2) using distance_m::numeric(10,2);
