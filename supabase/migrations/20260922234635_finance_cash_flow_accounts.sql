-- finance-charts phase 1. Which accounts are cash flow is the owner's call.
--
-- cashFlowByMonth summed every account, and an uncategorised row is read by
-- its sign, so a retirement contribution read as income and a brokerage buy as
-- spending. A kind rule cannot settle it: `other` accounts can hold large
-- balances that are probably holdings, and only the owner knows. So the
-- switch is per account, set in a drawer beside the chart.
--
-- Investments and `other` start off. A wrong "off" shows in the card head's
-- count; a wrong "on" overstates spending silently. The sync job sets the same
-- default from the kind on insert, because a column default cannot vary by it.

alter table finance.account
  add column in_cash_flow boolean not null default true;

update finance.account
   set in_cash_flow = false
 where kind in ('brokerage', 'retirement', 'crypto', 'other');

-- Asked for by the owner while filing the Unfiled list. Its own line rather
-- than folded into Shopping, so a budget says which of the two went over.
insert into finance.category (name, description, kind, is_fixed, position) values
  ('Entertainment', 'Movies, events, games and hobbies', 'expense', false, 23)
on conflict (name) do nothing;
