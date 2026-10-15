-- v1.1 Phase 6: a project can point at a goal. A task in that project counts
-- toward the goal unless it names its own; the coalesce lives in the reads.
-- Through core.entities, as tasks.task.goal_ref is, so tasks never references
-- the goals schema.
alter table tasks.project
  add column goal_ref uuid references core.entities (id) on delete set null;

-- Backfill: a project whose open tasks all carry the same non-null goal gets
-- it. A mixed or partly unlinked project stays null; the owner decides.
update tasks.project p
   set goal_ref = s.goal_ref
  from (select project_id, min(goal_ref::text)::uuid as goal_ref
          from tasks.task
         where status <> 'done' and project_id is not null
         group by project_id
        having count(distinct goal_ref) = 1 and bool_and(goal_ref is not null)) s
 where s.project_id = p.id;
