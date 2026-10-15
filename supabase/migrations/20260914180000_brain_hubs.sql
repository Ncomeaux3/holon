-- Hubs: a note can sit in more than one, which is what a folder cannot do.

create table brain.hub (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  keywords text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- Same shape as core.skill_links. A note can sit in more than one hub, which
-- is the whole reason a hub is not a folder.
create table brain.note_hub (
  note_id uuid not null references brain.note (id) on delete cascade,
  hub_id uuid not null references brain.hub (id) on delete cascade,
  confidence real not null default 1,
  classified_by text not null check (classified_by in ('rule', 'model', 'manual')),
  is_manual boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (note_id, hub_id)
);

create index note_hub_hub_idx on brain.note_hub (hub_id);

-- Relative to the brain bucket. Empty for a note with no file.
alter table brain.note add column file_path text not null default '';

do $$
declare
  t text;
begin
  foreach t in array array['hub', 'note_hub']
  loop
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
