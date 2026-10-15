-- Another module can post a recurring charge (v1.2 phase 11).
--
-- Insurance posts a policy's premium through finance.write_recurring, keyed by
-- (source, external_id) like every other imported row. A posted row carries the
-- category it belongs to, so its budget row can show the monthly equivalent as
-- set aside, and a premium bills quarterly or every six months as well.
--
-- The detector rewrites its rows by merchant. That key is now unique among
-- detected rows only, so a detection can never overwrite a posted premium.

alter table finance.recurring
  add column source text not null default 'detected',
  add column external_id text,
  add column category_id uuid references finance.category (id) on delete set null,
  add constraint recurring_source_external_key unique (source, external_id);

alter table finance.recurring drop constraint recurring_cadence_check;
alter table finance.recurring add constraint recurring_cadence_check
  check (cadence in ('weekly', 'monthly', 'quarterly', 'semiannual', 'yearly'));

alter table finance.recurring drop constraint recurring_merchant_key;
create unique index recurring_detected_merchant_key on finance.recurring (merchant)
  where source = 'detected';
