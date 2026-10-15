-- Second Brain, schema `brain` rather than `second_brain` (decision 14).
--
-- The design's premise: the vault is the source of truth and the app never
-- edits it without a review step. That is why a note has a `status`: an
-- ingested draft is not a note yet, it is a proposal about one, and the inbox
-- is where the owner turns the first into the second.

create schema if not exists brain;

grant usage on schema brain to authenticated, service_role, pos_readonly;
-- So brain.query keeps working as this module adds tables.
alter default privileges in schema brain grant select on tables to pos_readonly;

create table brain.note (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  -- Markdown. The vault's format, so a note can round trip without conversion.
  body text not null default '',

  -- The file name in the vault, and the target of a [[wikilink]]. Stable once
  -- set: renaming a note would break every link pointing at it, so the slug
  -- outlives the title.
  slug text not null unique,

  -- article | book | video | note | project | person | daily
  kind text not null default 'note'
    check (kind in ('article', 'book', 'video', 'note', 'project', 'person', 'daily')),

  -- draft: ingested, waiting for the owner. published: theirs.
  --
  -- The whole review step is this column. Nothing reaches the vault while it is
  -- a draft, which is what keeps the promise that the app does not write to the
  -- vault on its own.
  status text not null default 'published' check (status in ('draft', 'published')),

  -- Where it came from, when something fetched it.
  source_url text not null default '',
  -- The text as fetched, kept beside the summary so a draft can be judged
  -- against what it was drawn from rather than taken on trust.
  source_text text not null default '',
  source_meta text not null default '',

  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,

  -- The vault commit this note was last written in, so the app can say what is
  -- and is not on disk.
  committed_sha text not null default '',
  committed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index note_status_idx on brain.note (status, updated_at desc);
create index note_kind_idx on brain.note (kind, updated_at desc);

-- [[wikilinks]], resolved.
--
-- A row per direction of a link, written by the parser when a note is saved.
-- Kept as its own table rather than derived on read because the backlinks panel
-- asks the reverse question, and scanning every body for a title is the one
-- query that would not scale.
create table brain.link (
  from_note_id uuid not null references brain.note (id) on delete cascade,
  -- The slug as written in the link. Kept even when it resolves to nothing:
  -- a link to a note you have not written yet is a real thing in a vault, and
  -- it is how the next note gets started.
  to_slug text not null,
  to_note_id uuid references brain.note (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (from_note_id, to_slug)
);

create index link_to_idx on brain.link (to_note_id);
create index link_slug_idx on brain.link (to_slug);

do $$
declare
  t text;
begin
  foreach t in array array['note', 'link']
  loop
    execute format(
      'create trigger set_updated_at before update on brain.%I
       for each row execute function core.set_updated_at()', t);

    execute format('alter table brain.%I enable row level security', t);

    execute format(
      'create policy owner_all on brain.%I for all to authenticated
       using (true) with check (true)', t);

    execute format(
      'create policy readonly_select on brain.%I for select to pos_readonly using (true)', t);

    execute format('grant select, insert, update, delete on brain.%I to authenticated', t);
    execute format('grant all on brain.%I to service_role', t);
    execute format('grant select on brain.%I to pos_readonly', t);
  end loop;
end;
$$;

-- Finishing a book is the medium weight SPEC names. Approving a draft is worth
-- less than writing one from nothing, and an ingest on its own is worth zero:
-- saving a link is not reading it.
insert into skills.xp_weight (event_type, weight)
values ('note_created', 8), ('note_approved', 4), ('book_finished', 60), ('note_ingested', 0)
on conflict (event_type) do nothing;
