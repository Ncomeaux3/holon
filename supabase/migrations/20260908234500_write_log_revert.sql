-- Undo needs more than a diff to read. A diff says what changed; reversing it
-- means calling the same tool again with the values from before, so the log
-- carries that call ready to make.
--
-- Null is the honest answer for a write that cannot describe its own reverse,
-- and the Agent Log shows no Undo button for one. A dead button would be worse
-- than an absent one.
alter table core.write_log
  add column revert_payload jsonb;

-- What Redo re-applies. Undo replaces the row with revert_payload; without the
-- forward call kept alongside it, Redo would have nothing to send.
alter table core.write_log
  add column apply_payload jsonb;
