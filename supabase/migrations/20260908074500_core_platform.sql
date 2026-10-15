-- Platform tables the designed screens need: the agent log's run and write
-- records, the skill tree's editable overrides, and the columns the Review
-- screen shows for each proposal.
--
-- core_init configures core tables inside a do block that loops over pg_tables.
-- That loop does not re-run for a later migration, so every table added here
-- repeats the same five statements: updated_at trigger, RLS on, the owner
-- policy, the read policy for the query tool, and the three grants. Without
-- them a table is invisible to `authenticated` and to <module>.query.

-- Agent runs and writes ------------------------------------------------------

-- One row per cron invocation. core.jobs stays the per-job current state; this
-- is the history the Agent Log groups by.
create table core.job_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- cron | manual | mcp
  trigger_source text not null default 'cron',
  -- running | clean | partial | failed
  status text not null default 'running'
    check (status in ('running', 'clean', 'partial', 'failed')),
  duration_ms integer,
  log jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index job_runs_started_idx on core.job_runs (started_at desc);

-- Every agent and job write, with the value before it. core.events is append
-- only and carries no prior value, so undo needs its own record.
--
-- UI writes are deliberately absent: undo for those is the edit form, and
-- logging them would double the write path on every screen.
create table core.write_log (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references core.job_runs (id) on delete set null,
  module text not null,
  tool text not null,
  entity_ref uuid references core.entities (id) on delete set null,
  -- categorised | flagged | rescheduled | recomputed | classified | created
  kind text not null,
  title text not null,
  -- Why, shown under the title. Never null: an unexplained write is not one the
  -- owner can judge.
  reason text not null,
  -- [{ field, before, after }]
  diff jsonb not null default '[]'::jsonb,
  actor text not null default 'agent',
  undone_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index write_log_run_idx on core.write_log (run_id, created_at desc);
create index write_log_module_idx on core.write_log (module, created_at desc);

-- Skill tree overrides -------------------------------------------------------

-- config/skills.yaml stays the fork default and the thing a template user
-- edits. This holds what the owner changed in the UI on top of it, because the
-- Vercel filesystem is read only at runtime. Reset to skills.yaml is a delete
-- of every row.
create table core.skill_overrides (
  id uuid primary key default gen_random_uuid(),
  -- custom | rename | delete
  kind text not null check (kind in ('custom', 'rename', 'delete')),
  skill_id text not null,
  -- rename and custom only
  name text,
  -- custom only: which branch it hangs from
  parent text,
  keywords text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, skill_id)
);

-- Proposals --------------------------------------------------------------

-- The Review screen shows more than the original four columns: who proposed it,
-- what it would change, how sure it is, and what it would touch. These are
-- columns rather than payload keys because every one of them is rendered.
alter table core.proposals
  add column title text,
  add column agent text,
  add column confidence numeric check (confidence is null or confidence between 0 and 1),
  add column evidence text,
  add column affects text,
  add column guarded boolean not null default false,
  -- [{ field, before, after }], the same shape core.write_log.diff uses, so the
  -- Review panel and the Agent Log render it with one component.
  add column diff jsonb not null default '[]'::jsonb,
  -- Dismissing says "not this again for a while" rather than "never".
  add column dismissed_until timestamptz;

-- 'dismissed' is what the screen calls it, and it is not the same as a hard
-- reject: it comes back after dismissed_until.
alter table core.proposals drop constraint proposals_status_check;
alter table core.proposals add constraint proposals_status_check
  check (status in ('pending', 'approved', 'rejected', 'dismissed'));

-- Connections ------------------------------------------------------------

-- Onboarding lists more providers than the repo has manifests for. One without
-- a manifest saves as a manual connection so it shows in Settings without
-- pretending to sync.
alter table core.connections drop constraint connections_status_check;
alter table core.connections add constraint connections_status_check
  check (status in ('connected', 'error', 'expired', 'requested'));

-- Triggers, RLS, grants ------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['job_runs', 'write_log', 'skill_overrides']
  loop
    execute format(
      'create trigger set_updated_at before update on core.%I
       for each row execute function core.set_updated_at()', t);

    execute format('alter table core.%I enable row level security', t);

    execute format(
      'create policy owner_all on core.%I for all to authenticated
       using (true) with check (true)', t);

    execute format(
      'create policy readonly_select on core.%I for select to pos_readonly using (true)', t);

    execute format('grant select, insert, update, delete on core.%I to authenticated', t);
    execute format('grant all on core.%I to service_role', t);
    execute format('grant select on core.%I to pos_readonly', t);
  end loop;
end;
$$;
