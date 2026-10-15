-- Core schema: the registry, event log, and shared plumbing every module hangs
-- off. See docs/ARCHITECTURE.md "Core schema". Modules never edit this; they get
-- their own schema and link here.

create extension if not exists vector;
create extension if not exists pgcrypto;

create schema if not exists core;

-- Every table carries created_at and updated_at; this keeps updated_at honest.
create or replace function core.set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

-- Registry -------------------------------------------------------------------

-- Any row in any module schema gets one row here, which is what lets skill
-- links, events, and search work without core knowing about the module.
create table core.entities (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  entity_type text not null,
  entity_id text not null,
  title text not null,
  -- The indexable text for this entity. Search and embedding read it from here
  -- so core never has to reach into a module's own tables.
  body text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (module, entity_type, entity_id)
);
create index entities_module_idx on core.entities (module, entity_type);

create table core.skill_links (
  id uuid primary key default gen_random_uuid(),
  entity_ref uuid not null references core.entities (id) on delete cascade,
  skill_id text not null,
  weight numeric not null default 1,
  confidence numeric not null default 1 check (confidence between 0 and 1),
  -- 'rule', 'model:<id>', or 'unclassified'.
  classified_by text not null,
  -- Jobs never overwrite a row where this is true.
  is_manual boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_ref, skill_id)
);
create index skill_links_skill_idx on core.skill_links (skill_id);

-- Append only. Deletes are hard, so title_snapshot preserves what the row said
-- at the time and entity_ref goes null rather than taking the event with it.
create table core.events (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  entity_ref uuid references core.entities (id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  title_snapshot text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index events_occurred_idx on core.events (occurred_at desc);
create index events_type_idx on core.events (event_type);

-- Skill XP --------------------------------------------------------------------

-- Seeded from config/xp.yaml by pnpm setup.
create table core.xp_weights (
  event_type text primary key,
  weight numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- level = min(99, floor(sqrt(xp / 100))). Mirrored in core/xp.ts, and
-- core/xp.test.ts proves the two agree. greatest() keeps sqrt off negatives.
create or replace function core.level(xp int) returns int
language sql
immutable
as $$
  select least(99, floor(sqrt(greatest(xp, 0) / 100.0)))::int;
$$;

create view core.skill_xp
with (security_invoker = on)
as
select
  sl.skill_id,
  sum(w.weight * sl.weight * sl.confidence)::numeric as xp,
  core.level(sum(w.weight * sl.weight * sl.confidence)::int) as level,
  count(*)::int as event_count,
  max(e.occurred_at) as last_event_at
from core.events e
join core.skill_links sl on sl.entity_ref = e.entity_ref
join core.xp_weights w on w.event_type = e.event_type
group by sl.skill_id;

-- Operations ------------------------------------------------------------------

create table core.notifications (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'email',
  title text not null,
  body text not null,
  due_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notifications_pending_idx on core.notifications (due_at) where sent_at is null;

create table core.jobs (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  name text not null,
  schedule text,
  last_run timestamptz,
  last_status text check (last_status in ('ok', 'failed', 'running')),
  -- Also holds cursors for chunked work: { "cursor": ... }.
  log jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (module, name)
);

create table core.digests (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  run_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index digests_module_run_idx on core.digests (module, run_at desc);

create table core.dashboard_summary (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  summary jsonb not null default '{}'::jsonb,
  headline text,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dashboard_summary_run_idx on core.dashboard_summary (run_at desc);

-- Credentials for one provider, encrypted by core/crypto.ts. One row per
-- integration id. Nothing here is readable without ENCRYPTION_KEY.
create table core.connections (
  id uuid primary key default gen_random_uuid(),
  integration_id text not null unique,
  credentials_encrypted text not null,
  status text not null default 'connected' check (status in ('connected', 'error', 'expired')),
  last_tested_at timestamptz,
  last_test_detail text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- What an agent wants to do to a guarded tool, pending the owner's approval.
create table core.proposals (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  tool text not null,
  payload jsonb not null default '{}'::jsonb,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index proposals_pending_idx on core.proposals (created_at desc) where status = 'pending';

-- Search ----------------------------------------------------------------------

-- 1024 is the voyage-4-lite default dimension (verified 2026-09-05).
create table core.embeddings (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null unique references core.entities (id) on delete cascade,
  -- Skip re-embedding when this has not moved.
  content_hash text not null,
  embedding vector(1024),
  tsv tsvector,
  embedded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index embeddings_vector_idx on core.embeddings using hnsw (embedding vector_cosine_ops);
create index embeddings_tsv_idx on core.embeddings using gin (tsv);

-- Settings and ledgers ---------------------------------------------------------

-- timezone, owner_name, digest_hour, llm_soft_cap_cents. Seeded by pnpm setup.
create table core.settings (
  key text primary key,
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per model call, so month to date spend is a query and the soft cap
-- is enforceable.
create table core.llm_calls (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  model text not null,
  purpose text not null,
  module text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_cents numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index llm_calls_occurred_idx on core.llm_calls (occurred_at desc);

-- Every API and webhook call. Pruned to 90 days nightly.
create table core.request_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  route text not null,
  method text not null,
  status int not null,
  duration_ms int not null,
  ip_hash text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index request_log_occurred_idx on core.request_log (occurred_at desc);

-- Roles, RLS, grants -----------------------------------------------------------

-- The query tool connects as this role: SELECT only, and each module migration
-- grants it usage and select on that module's schema.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pos_readonly') then
    create role pos_readonly nologin;
  end if;
end;
$$;

-- core/query.ts connects as postgres and drops to pos_readonly with
-- `set local role`, which requires membership.
grant pos_readonly to postgres;

grant usage on schema core to authenticated, service_role, pos_readonly;

-- anon gets nothing: it is never a logged in owner, and signups are disabled.
revoke all on schema core from anon;

-- One pass over every core table: updated_at trigger, RLS on, a full policy for
-- the owner's session, a read policy for the query tool, and matching grants.
do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'core' order by tablename
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

grant select on core.skill_xp to authenticated, service_role, pos_readonly;
grant execute on function core.level(int) to authenticated, service_role, pos_readonly;

-- Module migrations add tables to their own schemas later; this keeps the query
-- tool able to read anything new in core without another grant.
alter default privileges in schema core grant select on tables to pos_readonly;
