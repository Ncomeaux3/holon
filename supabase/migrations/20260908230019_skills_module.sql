-- The skills module takes ownership of the skill tree.
--
-- Phase 1 built the tree into core. The design handoff does not: Skill Tree is
-- a module with its own schema, and only the generic link table stays in core.
-- See docs/plans/skills-module.md.
--
-- Staying in core: entities, events, skill_links. skill_links is the table
-- every module writes through register(); it is not a skills table.

create schema if not exists skills;

grant usage on schema skills to authenticated, service_role, pos_readonly;
-- So skills.query keeps working as this module adds tables.
alter default privileges in schema skills grant select on tables to pos_readonly;

-- The view depends on core.level, so it goes before the function moves.
drop view core.skill_xp;

-- Tables ---------------------------------------------------------------------

-- set schema carries the rows, the constraints, the RLS policies and the
-- set_updated_at trigger. It does not carry grants, which are restated below.
alter table core.xp_weights set schema skills;
alter table skills.xp_weights rename to xp_weight;

alter table core.skill_overrides set schema skills;
alter table skills.skill_overrides rename to override;

grant select, insert, update, delete on skills.xp_weight, skills.override to authenticated;
grant all on skills.xp_weight, skills.override to service_role;
grant select on skills.xp_weight, skills.override to pos_readonly;

-- Level ----------------------------------------------------------------------

-- level = min(99, floor(sqrt(xp / 100))). Mirrored in modules/skills/xp.ts, and
-- its test proves the two agree. greatest() keeps sqrt off negatives.
create or replace function skills.level(xp int) returns int
language sql
immutable
as $$
  select least(99, floor(sqrt(greatest(xp, 0) / 100.0)))::int;
$$;

drop function core.level(int);

-- XP -------------------------------------------------------------------------

-- Reads up into core, which is what every module does. Not a cross-schema key.
create view skills.xp
with (security_invoker = on)
as
select
  sl.skill_id,
  sum(w.weight * sl.weight * sl.confidence)::numeric as xp,
  skills.level(sum(w.weight * sl.weight * sl.confidence)::int) as level,
  count(*)::int as event_count,
  max(e.occurred_at) as last_event_at
from core.events e
join core.skill_links sl on sl.entity_ref = e.entity_ref
join skills.xp_weight w on w.event_type = e.event_type
group by sl.skill_id;

grant select on skills.xp to authenticated, service_role, pos_readonly;
grant execute on function skills.level(int) to authenticated, service_role, pos_readonly;
