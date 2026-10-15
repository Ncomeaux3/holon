-- v1.2 phase 5a. A category says what kind of money it holds, so a budget
-- counts the right things: paying a card off is a transfer between the owner's
-- own accounts and never spending on either side; a refund or a statement
-- credit is money back that nets against the category it refunds, never
-- income. The sum over a category is still a plain signed sum; the kind only
-- decides which categories are budgets.

alter table finance.category
  add column kind text not null default 'expense'
    check (kind in ('expense', 'income', 'transfer', 'credit'));

update finance.category set kind = 'income' where name = 'Income';
-- Renamed in place: the id, and every rule that points at it, survive.
update finance.category
   set name = 'Account transfer', kind = 'transfer'
 where name = 'Transfer';
-- A contribution is a move into a brokerage the owner also holds.
update finance.category set kind = 'transfer' where name = 'Investing';

insert into finance.category (name, description, kind, is_fixed, position) values
  ('Credit card payment', 'Paying a card off from checking',        'transfer', false, 11),
  ('Refund',              'Money back with no charge to net against', 'credit',   false, 12),
  ('Statement credit',    'Card rewards and statement credits',      'credit',   false, 13),
  ('Fees and interest',   'Bank fees, interest charged',             'expense',  false, 14),
  ('Taxes',               'Income and property tax payments',        'expense',  false, 15),
  ('Insurance premiums',  'Auto, renters, life, health',             'expense',  true,  16),
  ('Medical',             'Doctors, pharmacy, dental',               'expense',  false, 17),
  ('Gifts and donations', 'Presents and giving',                     'expense',  false, 18),
  ('Education',           'Courses, books, tuition',                 'expense',  false, 19),
  ('Home maintenance',    'Repairs, furnishings, supplies',          'expense',  false, 20),
  ('Pets',                'Food, vet, supplies',                     'expense',  false, 21)
on conflict (name) do nothing;

-- Whether a pending charge counts toward a budget before it posts. Off: the
-- number on the screen is what the bank has settled.
alter table finance.settings
  add column count_pending boolean not null default false;
