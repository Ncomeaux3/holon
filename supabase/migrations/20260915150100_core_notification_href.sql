-- A warning row on the dashboard goes somewhere (v1.1 Phase 5). The module
-- that queues the notification names the screen; a row with no href opens
-- the alert centre.
alter table core.notifications add column href text;
