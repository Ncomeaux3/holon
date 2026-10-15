-- finance-charts phase 3. One window, chosen once, over both charts.
--
-- The cash flow card and the category trend each took a hardcoded month count.
-- The owner picks one number instead, saved so it holds across a reload. The
-- check is the allowed set, so an out-of-range value cannot land by any path.

alter table finance.settings
  add column chart_months int not null default 12 check (chart_months in (3, 6, 12, 24));
