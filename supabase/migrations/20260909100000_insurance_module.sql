-- Insurance and policies.
--
-- Deductible, coverage limits, agent and documents are discrete columns per the
-- 2026-09-07 decision that amended SPEC section 8. They are facts copied off a
-- declarations page, not judgements. SPEC's real rule stands and is the rule
-- this module is built to: nothing here analyses them. No gap analysis, no
-- adequacy scoring, no model opinion about whether cover is enough.

create schema if not exists insurance;

grant usage on schema insurance to authenticated, service_role, pos_readonly;
-- So insurance.query keeps working as this module adds tables.
alter default privileges in schema insurance grant select on tables to pos_readonly;

create table insurance.policy (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in
    ('auto', 'renters', 'homeowners', 'health', 'dental', 'vision', 'life', 'pet',
     'device', 'umbrella', 'other')),
  name text not null,
  carrier text not null default '',

  -- Encrypted at rest with core/crypto, like every credential. The list never
  -- carries it: reading one is an explicit action that decrypts a single row.
  policy_number_encrypted text,

  expires_on date,
  -- Cents, and the cadence it is billed at. Annualising is done on read so the
  -- stored number is the one on the bill.
  premium_cents integer not null default 0 check (premium_cents >= 0),
  cadence text not null default 'monthly'
    check (cadence in ('monthly', 'quarterly', 'semiannual', 'annual')),

  -- Null is "not on this policy", which term life genuinely is not. Zero would
  -- be a claim that the deductible is nothing.
  deductible_cents integer check (deductible_cents >= 0),
  -- Free text, in the words on the declarations page: "100/300/100", "$1,500
  -- annual max". Not parsed, not compared, not scored.
  limits text not null default '',

  agent_name text not null default '',
  agent_contact text not null default '',

  -- Days before expiry to remind. The nightly job queues one notification per
  -- lead that lands today.
  reminder_leads integer[] not null default '{60,30,7}',
  -- Whether the premium should show on the Finance timeline as a recurring
  -- charge. Finance owns that row; this is only the owner's intent.
  post_to_finance boolean not null default false,

  status text not null default 'active' check (status in ('active', 'lapsed', 'cancelled')),
  notes text not null default '',

  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index policy_expires_idx on insurance.policy (expires_on);

create table insurance.document (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references insurance.policy (id) on delete cascade,
  name text not null,
  -- "8 pages", "Mar 2026". What the row shows under the name.
  meta text not null default '',
  -- Path inside the private insurance bucket. Reading one is a signed URL that
  -- expires; nothing here is ever public.
  file_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index document_policy_idx on insurance.document (policy_id, created_at desc);

do $$
declare
  t text;
begin
  foreach t in array array['policy', 'document']
  loop
    execute format(
      'create trigger set_updated_at before update on insurance.%I
       for each row execute function core.set_updated_at()', t);

    execute format('alter table insurance.%I enable row level security', t);

    execute format(
      'create policy owner_all on insurance.%I for all to authenticated
       using (true) with check (true)', t);

    execute format(
      'create policy readonly_select on insurance.%I for select to pos_readonly using (true)', t);

    execute format('grant select, insert, update, delete on insurance.%I to authenticated', t);
    execute format('grant all on insurance.%I to service_role', t);
    execute format('grant select on insurance.%I to pos_readonly', t);
  end loop;
end;
$$;

-- Reading a policy through and writing down what it covers is Life ops work.
-- Renewing one is paperwork, and it happens whether or not you understood it.
insert into skills.xp_weight (event_type, weight)
values ('policy_reviewed', 5), ('policy_renewed', 2)
on conflict (event_type) do nothing;
