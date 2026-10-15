-- The notes module: the smallest real module, and the worked example every
-- other module is copied from. See modules/notes/README.md.

create schema if not exists notes;

create table notes.note (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  -- Every module table carries these two so imports are idempotent and a row's
  -- origin is always visible. See docs/ARCHITECTURE.md "Module rules".
  external_id text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);
create index note_created_idx on notes.note (created_at desc);

create trigger set_updated_at before update on notes.note
for each row execute function core.set_updated_at();

alter table notes.note enable row level security;

create policy owner_all on notes.note for all to authenticated
  using (true) with check (true);
create policy readonly_select on notes.note for select to pos_readonly using (true);

grant usage on schema notes to authenticated, service_role, pos_readonly;
grant select, insert, update, delete on notes.note to authenticated;
grant all on notes.note to service_role;
grant select on notes.note to pos_readonly;

-- So <id>.query keeps working as this module adds tables.
alter default privileges in schema notes grant select on tables to pos_readonly;
