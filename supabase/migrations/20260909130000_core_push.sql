-- Web push subscriptions.
--
-- The rules table has stored a `push` channel since 2026-09-07 and the sender
-- ignored it, by decision, until this migration. This is that step.
--
-- One row per browser, not per person: there is one owner, and the same person
-- on a laptop and a phone is two subscriptions that expire independently.

create table core.push_subscription (
  id uuid primary key default gen_random_uuid(),

  -- The push service's URL for this browser. Unique because re-subscribing on
  -- the same device returns the same endpoint, and a second row would send the
  -- same notification twice.
  endpoint text not null unique,
  -- The browser's keys, from PushSubscription.toJSON(). Not secrets of ours:
  -- they are useless without the VAPID private key, which lives in .env.
  p256dh text not null,
  auth text not null,

  -- So the owner can tell which device they are turning off.
  label text not null default '',

  -- Bumped when a send fails in a way that is not fatal. A subscription the
  -- push service says is gone is deleted rather than counted.
  failure_count integer not null default 0,
  last_sent_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  create trigger set_updated_at before update on core.push_subscription
    for each row execute function core.set_updated_at();

  alter table core.push_subscription enable row level security;

  create policy owner_all on core.push_subscription for all to authenticated
    using (true) with check (true);

  grant select, insert, update, delete on core.push_subscription to authenticated;
  grant all on core.push_subscription to service_role;
end;
$$;
