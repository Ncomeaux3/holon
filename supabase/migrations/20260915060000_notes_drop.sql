-- v1.1 Phase 2: the phase-1 notes stub is gone. Second Brain is the notes
-- module. The shipped 20260905223936_notes_init.sql stays as history.
--
-- core.entities rows cascade into core.skill_links; core.events keeps its rows
-- with entity_ref set null, because the log is append only. Digests
-- go too because the dashboard reads the latest row per module with no
-- registry filter, so a leftover row would keep a Notes tile alive. A
-- pending proposal for a tool that no longer exists can never be approved.
-- core.write_log stays: it is history, and the seed owns its demo rows.
delete from core.entities where module = 'notes';
delete from core.digests where module = 'notes';
delete from core.jobs where module = 'notes';
delete from core.proposals where module = 'notes' and status = 'pending';
drop schema notes cascade;
