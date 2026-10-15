-- The Finance module.
--
-- Money is integer cents everywhere. Never a float: 0.1 + 0.2 is not 0.3, and a
-- budget that is a cent out every month is a budget nobody trusts. The UI
-- renders dollars; nothing but the renderer ever sees one.
--
-- Sign convention: positive is money out. Income is negative. It reads
-- backwards for a second and then never again, and it means a category total is
-- a sum with no case analysis anywhere.

create schema if not exists finance;

grant usage on schema finance to authenticated, service_role, pos_readonly;
-- So finance.query keeps working as this module adds tables.
alter default privileges in schema finance grant select on tables to pos_readonly;

-- Accounts --------------------------------------------------------------------

create table finance.account (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  institution text not null default '',
  -- checking | savings | brokerage | retirement | credit | crypto | other
  kind text not null default 'other'
    check (kind in ('checking', 'savings', 'brokerage', 'retirement', 'credit', 'crypto', 'other')),

  -- The current balance, in cents. Negative on a credit card, which is what
  -- makes net worth a plain sum over every account.
  balance_cents bigint not null default 0,

  -- The last four, and nothing more. The full number is an account identifier
  -- and SPEC says those are encrypted at rest; this module never needs it.
  mask text not null default '',

  -- Which connection syncs it. Null for an account kept by hand.
  connection_id uuid references core.connections (id) on delete set null,

  archived boolean not null default false,
  source text not null default 'manual'
    check (source in ('manual', 'agent', 'simplefin', 'notion_import', 'demo')),
  external_id text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

-- One row per account per day, written nightly. This is what the 31 point net
-- worth chart reads, and what makes a 30 day change a fact rather than a guess.
create table finance.balance_daily (
  account_id uuid not null references finance.account (id) on delete cascade,
  on_date date not null,
  balance_cents bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, on_date)
);

-- Categories and the rules that assign them --------------------------------

create table finance.category (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- What the drawer prints under the heading, in the owner's words.
  description text not null default '',
  -- Rent does not flex, so it is never flagged for being at 100 percent.
  is_fixed boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table finance.category_rule (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references finance.category (id) on delete cascade,
  -- Normalised: lowercase, single spaced. modules/finance/categorise.ts owns
  -- the matching, and its test owns the definition of a match.
  pattern text not null,
  -- True when the owner's own correction wrote it. Beats any automatic rule,
  -- and a job may never overwrite one.
  is_manual boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pattern, category_id)
);

-- Transactions ----------------------------------------------------------------

create table finance.transaction (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references finance.account (id) on delete cascade,

  -- What the bank sent, unmodified. The normalised merchant is derived, and
  -- keeping the raw string is what lets a rule be re-run over history.
  descriptor text not null,
  merchant text not null default '',

  amount_cents bigint not null,
  occurred_on date not null,

  category_id uuid references finance.category (id) on delete set null,
  -- rule | model | manual. Every model decision stores its confidence, per the
  -- system rule that a model decision is always marked as one.
  classified_by text check (classified_by in ('rule', 'model', 'manual')),
  confidence numeric check (confidence is null or confidence between 0 and 1),
  -- The owner categorised it by hand, so no job may touch the category again.
  is_manual boolean not null default false,

  pending boolean not null default false,
  source text not null default 'manual'
    check (source in ('manual', 'agent', 'simplefin', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create index transaction_date_idx on finance.transaction (occurred_on desc);
create index transaction_account_idx on finance.transaction (account_id, occurred_on desc);
create index transaction_category_idx on finance.transaction (category_id, occurred_on desc);
create index transaction_merchant_idx on finance.transaction (merchant);

-- Budgets ---------------------------------------------------------------------

-- One limit per category per month. A month rather than a single standing
-- limit, because "what did I budget in March" is a question you ask in April.
create table finance.budget (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references finance.category (id) on delete cascade,
  -- The first of the month it applies to.
  month date not null,
  limit_cents bigint not null check (limit_cents > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, month)
);

-- Recurring and subscriptions -------------------------------------------------

-- What modules/finance/recurring.ts detected. Rewritten by the nightly job, so
-- nothing the owner edits lives here: a subscription they curate is its own row
-- below, linked back to this one.
create table finance.recurring (
  id uuid primary key default gen_random_uuid(),
  merchant text not null unique,
  amount_cents bigint not null,
  cadence text not null check (cadence in ('weekly', 'monthly', 'yearly')),
  occurrences integer not null default 0,
  last_charge_on date not null,
  next_charge_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table finance.subscription (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vendor text not null default '',
  amount_cents bigint not null,
  cadence text not null default 'monthly'
    check (cadence in ('weekly', 'monthly', 'yearly')),
  next_charge_on date,
  category_id uuid references finance.category (id) on delete set null,

  -- The detection this was promoted from, kept so the screen can say a charge
  -- stopped arriving without re-deriving it.
  recurring_id uuid references finance.recurring (id) on delete set null,

  status text not null default 'active'
    check (status in ('active', 'paused', 'cancelled')),
  -- SPEC asks for this by name: where to go to stop paying for it.
  cancel_url text not null default '',
  notes text not null default '',

  source text not null default 'manual'
    check (source in ('manual', 'agent', 'notion_import', 'demo')),
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

-- Triggers, RLS, grants --------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['account', 'balance_daily', 'category', 'category_rule',
                           'transaction', 'budget', 'recurring', 'subscription']
  loop
    execute format(
      'create trigger set_updated_at before update on finance.%I
       for each row execute function core.set_updated_at()', t);

    execute format('alter table finance.%I enable row level security', t);

    execute format(
      'create policy owner_all on finance.%I for all to authenticated
       using (true) with check (true)', t);

    execute format(
      'create policy readonly_select on finance.%I for select to pos_readonly using (true)', t);

    execute format('grant select, insert, update, delete on finance.%I to authenticated', t);
    execute format('grant all on finance.%I to service_role', t);
    execute format('grant select on finance.%I to pos_readonly', t);
  end loop;
end;
$$;

-- The categories the design ships with. A fork edits them; nothing here is
-- personal, and the rules that fill them are learned rather than seeded.
insert into finance.category (name, description, is_fixed, position) values
  ('Income',        'Payroll, interest, refunds',        false, 0),
  ('Rent',          'Fixed, paid on the first',          true,  1),
  ('Groceries',     'Supermarkets and food shopping',    false, 2),
  ('Dining',        'Restaurants, coffee, delivery',     false, 3),
  ('Gas / Auto',    'Fuel, parking, service',            false, 4),
  ('Subscriptions', 'Detected recurring charges',        false, 5),
  ('Shopping',      'Retail and online',                 false, 6),
  ('Travel',        'Airlines, hotels, rideshare',       false, 7),
  ('Fitness',       'Gym fees and gear',                 false, 8),
  ('Transfer',      'Between your own accounts',         false, 9),
  ('Investing',     'Contributions and market change',   false, 10)
on conflict (name) do nothing;

-- Money is the largest weight outside a finished goal: the point of the module
-- is that classifying a month teaches the rules, and that is real work.
insert into skills.xp_weight (event_type, weight)
values ('transaction_categorised', 1), ('subscription_cancelled', 15), ('budget_set', 5)
on conflict (event_type) do nothing;
