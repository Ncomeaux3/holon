-- v1.2 Phase 6b: a task can repeat. The rule is { every, on?, interval? }
-- (modules/tasks/repeat.ts); completing the task writes the next instance and
-- the completed row keeps its rule for history.
alter table tasks.task
  add column repeat jsonb,
  -- The instance this one was written from. Unique, so completing a task,
  -- reopening it and completing it again cannot write a second next instance:
  -- one open instance at a time is the constraint, not a check in the tool.
  add column repeat_from uuid unique references tasks.task (id) on delete set null;
