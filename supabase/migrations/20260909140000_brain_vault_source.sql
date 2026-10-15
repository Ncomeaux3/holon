-- Second Brain pulls from the Obsidian vault, so a note can now come from one.
--
-- `vault` is distinct from `manual` on purpose. A vault note is a file that
-- exists on disk and whose text the app does not own: the pull rewrites it from
-- the file on every change, and the unique (source, external_id) below keys it
-- to the vault path rather than to anything the app made up. A manual note has
-- no file behind it until the owner publishes one.

alter table brain.note
  drop constraint note_source_check;

alter table brain.note
  add constraint note_source_check
  check (source in ('manual', 'agent', 'vault', 'notion_import', 'demo'));

-- The blob sha of the file this note was last read from.
--
-- `committed_sha` already exists and means the opposite direction: the commit
-- the app last wrote the note in. This one is what the pull compares against to
-- decide whether a file changed, and it is why re-running the pull over an
-- unchanged vault costs one request and no writes.
alter table brain.note
  add column if not exists vault_sha text not null default '';

comment on column brain.note.vault_sha is
  'Git blob sha of the vault file this note was last read from. Empty for a note with no file behind it.';
