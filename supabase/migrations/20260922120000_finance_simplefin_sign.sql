-- Every transaction pulled from SimpleFIN was stored in the bank's sign.
--
-- The protocol says "positive numbers indicate money being deposited into the
-- account"; this schema says positive is money out (20260909020000). Nothing
-- flipped between them, so every purchase was negative and read as income:
-- budgets summed to nothing, recurring detection skipped every real charge
-- (recurring.ts refuses amountCents <= 0), and the digest's unusual list named
-- deposits. The flip now happens once, in integrations/simplefin/client.ts.
--
-- This corrects the rows already stored. Only the simplefin source: manual,
-- demo and agent rows were always written in this schema's convention.
-- Balances are untouched: a card owed is negative in both conventions and net
-- worth is a plain sum over them.

update finance.transaction
   set amount_cents = -amount_cents
 where source = 'simplefin';

-- What the old sign taught the detector is worse than nothing: every row in
-- finance.recurring was found among inverted amounts, so a paycheck could be
-- there and a subscription could not. The table is derived and rewritten by
-- the nightly detect_subscriptions job, so emptying it is a re-detection, not
-- a loss. A subscription the owner curated is its own row and keeps its
-- recurring_id, which is set null rather than cascading the row away.
update finance.subscription set recurring_id = null where recurring_id is not null;
delete from finance.recurring;
