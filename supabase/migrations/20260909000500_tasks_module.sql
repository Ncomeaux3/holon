-- The Tasks module. Two tables: a project is a folder, a task is the work.
--
-- goal_id points at core.entities, not at a goals table. Cross-module links go
-- through the core registry, which is what it is for, so this migration lands
-- before the goals module exists and needs nothing changed when it arrives.

create schema if not exists tasks;

grant usage on schema tasks to authenticated, service_role, pos_readonly;
-- So tasks.query keeps working as this module adds tables.
alter default privileges in schema tasks grant select on tables to pos_readonly;

-- Projects -------------------------------------------------------------------

create table tasks.project (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- Ordering in the by-project view. Positional, so renaming does not reorder.
  position integer not null default 0,
  archived boolean not null default false,
  source text not null default 'manual',
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

-- Tasks ----------------------------------------------------------------------

create table tasks.task (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text not null default '',

  -- A date, not a timestamp: "due Thursday" is a day, and storing it as a
  -- timestamp makes it wrong for anyone who crosses a timezone. The time of
  -- day, when there is one, is its own column and is often absent.
  due_on date,
  due_at time,

  priority text not null default 'P2' check (priority in ('P1', 'P2', 'P3')),

  -- open | done. Agent-created tasks start in review, which is a third state:
  -- they are real rows, they just do not count as work until approved.
  status text not null default 'open' check (status in ('open', 'review', 'done')),

  project_id uuid references tasks.project (id) on delete set null,

  -- The core registry row for a goal. Not a foreign key into another module's
  -- schema, and null until the goals module exists.
  goal_ref uuid references core.entities (id) on delete set null,

  estimated_minutes integer check (estimated_minutes is null or estimated_minutes >= 0),

  -- How long before due_at a reminder fires. Null means no reminder.
  remind_minutes integer,

  -- 'demo' is what seed.ts writes, and it has to be a real value: the demo
  -- rows go through the same register() path as a live write, so they are not
  -- distinguishable any other way.
  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,

  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (source, external_id),

  -- A done task has a completion time and an open one does not. Without this
  -- the Done view and the digest disagree about what happened today.
  constraint task_done_has_time check (
    (status = 'done') = (completed_at is not null)
  )
);

create index task_due_idx on tasks.task (due_on) where status <> 'done';
create index task_project_idx on tasks.task (project_id) where status <> 'done';
create index task_goal_idx on tasks.task (goal_ref) where status <> 'done';
create index task_done_idx on tasks.task (completed_at desc) where status = 'done';

-- Triggers, RLS, grants ------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['project', 'task']
  loop
    execute format(
      'create trigger set_updated_at before update on tasks.%I
       for each row execute function core.set_updated_at()', t);

    execute format('alter table tasks.%I enable row level security', t);

    execute format(
      'create policy owner_all on tasks.%I for all to authenticated
       using (true) with check (true)', t);

    execute format(
      'create policy readonly_select on tasks.%I for select to pos_readonly using (true)', t);

    execute format('grant select, insert, update, delete on tasks.%I to authenticated', t);
    execute format('grant all on tasks.%I to service_role', t);
    execute format('grant select on tasks.%I to pos_readonly', t);
  end loop;
end;
$$;

-- XP -------------------------------------------------------------------------

-- Completing a task is small XP. Creating one is none: intent is not work, and
-- a weight on task_created would pay for writing the list instead of doing it.
insert into skills.xp_weight (event_type, weight)
values ('task_completed', 10), ('task_created', 0)
on conflict (event_type) do nothing;
