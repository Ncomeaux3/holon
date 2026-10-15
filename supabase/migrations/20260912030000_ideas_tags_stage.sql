-- The Ideas artboard shows tags on a card, how long an idea has sat in its
-- stage, and the validation task an agent drafted for it. None of those had a
-- column: updated_at moves on every edit, which is not the same thing as the
-- stage changing, and the draft is a task in another module's schema that
-- Ideas may not read, so the tool that writes it keeps what it wrote.

alter table ideas.idea
  add column tags text[] not null default '{}',
  add column stage_since timestamptz not null default now(),
  add column draft_task_id uuid,
  add column draft_title text;

update ideas.idea set stage_since = updated_at;
