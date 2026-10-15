-- What the browser saw break (v1.2 Phase 2). error.tsx and global-error.tsx
-- post here through /api/client-error, so a render failure on the phone is
-- readable in the Agent log's Errors tab instead of only in Vercel's short
-- retention. Pruned to 30 days by the nightly prune stage, beside request_log.
create table core.client_errors (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  route text not null,
  -- Next's server side digest, when the failure had one, so the row can be
  -- matched to the Vercel log line that carries the real message.
  digest text,
  message text not null,
  stack text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index client_errors_occurred_idx on core.client_errors (occurred_at desc);

-- core_init's setup loop does not re-run for a later table, so the same five
-- statements are repeated here (see core_platform).
create trigger set_updated_at before update on core.client_errors
  for each row execute function core.set_updated_at();
alter table core.client_errors enable row level security;
create policy owner_all on core.client_errors for all to authenticated using (true) with check (true);
create policy readonly_select on core.client_errors for select to pos_readonly using (true);
grant select, insert, update, delete on core.client_errors to authenticated;
grant all on core.client_errors to service_role;
grant select on core.client_errors to pos_readonly;
