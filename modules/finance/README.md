# Finance

Net worth, budgets, subscriptions and the ledger. Screen 04 of the design
bundle, and the module the guard exists for.

## Two conventions, both load-bearing

**Money is integer cents. Never a float.** `0.1 + 0.2` is not `0.3`, and a
budget that is a cent out every month is a budget nobody trusts. Dollars exist
only in `money.ts`, at the edge, on the way to the screen.

**Positive is money out. Income is negative.** It reads backwards for a second
and then never again, and it means a category total is a sum with no case
analysis anywhere. `transactionAmount()` is the single place that knows the
convention is inverted from what a person expects.

`balance()` and `signedMoney()` are separate functions on purpose. A card
balance of `-231000` is "-$2,310" and means debt; a 30 day change of `-64000`
is "-$640" and means it fell. Same glyph, different fact, so neither is used
for the other's job.

## Recurring detection

`recurring.ts`, written test first because SPEC names it and because a wrong
answer here is expensive in both directions.

Three occurrences minimum, every amount within ten percent of the **median**,
and every gap within slack of one cadence. Monthly gets five days of slack:
months are 28 to 31 days, billing dates land on weekends and get pushed, and a
card that posts a day late is still the same subscription.

The bias is against false positives throughout. A bill on the dashboard that is
not real teaches you to ignore the tile, and an ignored tile is worse than an
empty one. Two charges is a coincidence, not a cadence. Income is skipped
outright: a fortnightly paycheck is the most regular thing in the data and
belongs nowhere near the upcoming charges tile.

The demo seed proves it rather than asserting it. Four monthly cycles of five
merchants go in alongside twelve scattered shops and a payroll; the detector
finds exactly the five.

`isStale()` flags a subscription with no charge in **two** cycles, per SPEC. Two
rather than one because a single missed cycle is usually a billing date that
moved, and flagging on one would cry wolf every time a card was reissued. It
sets `paused`, never `cancelled`: the charge stopping might mean the card was
reissued, and this module does not get to decide you cancelled something.

## Categorisation

`categorise.ts`, also test first. Rules first, model second, and the interface
to "second" is `null`: everything in that file exists to return null less often,
because a month is hundreds of rows and sending each to a model would be the
largest line on the bill.

Ranking is manual before automatic, then `priority`, then longest pattern
first. Manual wins outright because the owner's correction is the one fact a job
may never overwrite. Length breaks the rest, so `amazon prime` beats `amazon`.
`priority` exists for one case and is set only on the three peer built-ins:
"Zelle Transfer to Jane" carries both `zelle` and `transfer to`, and on length
alone money to a person was filed `Account transfer`, whose kind is never
counted as spending.

`learnFrom()` turns a correction into a rule, which is the compounding value of
the module: every rule learned is a model call not made next month. It strips
the processor prefix (`SQ *`, `TST*`) and then the trailing reference, and only
then drops a short token the reference was sitting behind. That last step is
what turns `WHOLEFDS ABC 10045` into `wholefds` while leaving `BIG SPOON
CREAMERY` intact, and it is the case worth reading the test for.

The nightly `categorise` job does not send anything to a model yet; that arm is
v1.2 phase 5d. Unmatched rows stay uncategorised and are reachable through the
Transactions tab's Uncategorised chip and the Rules drawer's Unfiled list.

Since v1.2 phase 5a, filing a row by hand does not learn a rule by itself: the
row offers "Always file {merchant} as {category}", and Always writes the rule
through `learn_rule`. `BUILTIN_RULES` in `categorise.ts` are appended after the
learned rules on every run (a manual rule still wins): the card side and the
checking side of paying a card off ("payment thank you", "epayment", "credit
crd autopay") go to Credit card payment, and so does any descriptor naming a
card institution with a payment word; "online transfer" is
Account transfer; "membership rewards credit" is Statement credit; "dining
credit" and "uber credit" net against Dining and Travel. Money back on a card
from a merchant charged in the last 90 days (`matchRefund`) files into that
charge's category, or into Refund when the charge had none.

## Rules, and what writing one does

Since v1.2 phase 5c a rule is not only a thing the next sync consults: writing,
editing or deleting one re-files the history it matches, straight away. That is
the only way a backlog clears, and on a real ledger nearly every row starts in
the backlog, because `BUILTIN_RULES` is eleven payment, transfer and credit
patterns and nothing there files an ordinary purchase.

`rules.ts` is the one place that answers which rows a rule touches.
`refile(pattern)` selects every row with `is_manual = false` whose normalised
descriptor contains the pattern and runs the *whole* ranked set over each one,
writing the winner or clearing the row when nothing matches any more. Running
the set rather than forcing the one rule that occasioned it is what stops a
short new rule stealing rows a longer one owns, and what lets a delete hand its
rows to the next rule instead of orphaning them. `applyRule` and `removeRule`
are each one line over it, and neither can write a manual row: the guard is in
the SQL as well as in the select.

`loadRuleSet()` shapes the stored rules and the built-ins together, and carries
the 90 days of card charges the refund matcher needs; `classify()` beside it is
the one answer to "what is this row", rules first and then `matchRefund`. The
nightly job reads both, so a rule cannot mean one thing when it is written and
another at 3am, and a back-file cannot clear a refund the sweep had filed.

Two bounds worth knowing. `unfiledMerchants()` reads the 5000 newest
uncategorised rows: past that the oldest unfiled ones are not listed, and the
Uncategorised chip's count (a `count(*)` over the whole ledger) is the number
that stays honest. The nightly sweep takes 5000 rows a run. The SQL normalisation in `NORMALISED` has to agree with
`normalise()` in `categorise.ts`; a pattern is normalised before it is stored,
which is also why it is safe in a `LIKE` without escaping.

`finance.category_rule` carries `classified_by` ('human' or 'model') and
`confidence`, which SPEC asks of every model decision. `is_manual` keeps its one
job as the override flag. The tools are `write_rule` and `delete_rule`, both
unguarded for the reason `categorise` is: hundreds of rows a month through the
Review inbox would make the inbox useless.

The screen is the Rules drawer (`ui/RulesDrawer.tsx`), opened from the
Transactions tab on the phone and from the Budgets card head on the desktop,
which has no transactions surface of its own. It lists the owner's and the
model's rules with a provenance badge and a category select (the pattern is not
editable on screen: delete and file again reaches the same state, and the
pattern column is 80px on a phone), the eleven built-ins read-only below them,
and an Unfiled list grouped by `groupUnfiled()` onto the pattern a rule
would use, so two store numbers of one merchant are one row. Every write says
how many rows moved, because a back-file moves past budgets with it.

### Category kinds

`finance.category.kind` is `expense`, `income`, `transfer` or `credit`. Only
`expense` categories are budgets. A transfer (Credit card payment, Account
transfer, Investing) is money moving between the owner's own accounts and is
never spending, never a recurring charge, never an unusual transaction. A credit
kind (Refund, Statement credit) is money back that is not income. A credit
filed into an expense category is a negative row there, so "expense minus
credit" is the plain signed sum. A pending row waits until it posts unless
`finance.settings.count_pending` is on (the Budget limits drawer).

### The overview's three reads

`cashFlowByMonth(chart_months)` puts the kinds to work: income is the `income` kind with
its sign flipped, spending is `expense` plus `credit` (a credit is a negative
row, so that sum is already expense minus credit), and a transfer is on neither
side. A row with no category yet is read by its sign, because that is what the
sign convention means; dropping it would make a freshly pulled month look
emptier than it was. Every month of the window comes back whether it has rows
or not: a quiet month drawn as a missing bar and one drawn as no bar are
different claims.

Only accounts with `finance.account.in_cash_flow` count (finance-charts phase
1). A brokerage buy or a retirement contribution is money moving inside
holdings, and an uncategorised one read by its sign looked like spending or
income. The owner sets the switch per account in the Cash flow accounts drawer
(`?cashflow=1`, tool `set_cash_flow_accounts`); brokerage, retirement, crypto
and `other` start off, from the migration for existing rows and from the sync
job and the demo seed on insert, and nothing overwrites it after that. The card
head says "N of M accounts" so an exclusion is never silent. Only this read
uses the switch: budgets, the category trend and net worth see every account,
and `netThisMonthCents` follows because it is `cashFlowByMonth(1)`.

The sign fallback has one known ceiling: an **unfiled** card payment is `+` in
checking and `-` on the card, so it adds the same amount to both bars. The left
over line and `netThisMonthCents` are unaffected, and the built-in payment rules
normally file these before the chart ever sees them.

Every chart reads out under the pointer (finance-charts phase 2). `useScrub` in
`components/pos/LineChart.tsx` is the one interaction for `LineChart` and the
cash flow card: pointer events cover a mouse and a finger, `touch-action:
pan-y` lets a sideways scrub read the chart while an up or down swipe still
scrolls, and the chart takes focus so the arrows, Home, End and Escape do the
same from a keyboard, with a `role="status"` line saying it to a screen reader.
The cash flow readout is `flowReadout()` in `money.ts`: the month with its year,
In and Out through `balance()` (spending goes below zero when a refund outran a
month), and Left over through `signedMoney()`, so under half a dollar is flat.
"Net" is "Left over" on the card, and zero gets its own "$0" label when a month
ran a deficit and the floor is no longer zero.

`dueSoon(14)` reads both `finance.subscription` and `finance.recurring`,
deduped by `recurring_id` or name. They are not the same set and nothing
promotes one into the other: reading only subscriptions left the Upcoming card
empty on a real install while the detector had a dozen rows. Only a curated
subscription can be cancelled, because the nightly job would write a detection
straight back. A cancelled subscription suppresses its detection for the same
reason: Cancel means stop showing me this, and `finance.recurring` is rewritten
nightly, so this read is the only place that can honour it. A paused one does
not: paused is the detector saying the charges stopped arriving, so if it now
says one is due, that is the row worth showing. The Balance after column is `runningBalance()` in `money.ts`
over the largest checking account, not a column on the query: cancelling a
charge has to re-run it over what is left, and a number computed on the server
would be stale in every row below the cancelled one. It is a projection and
not a forecast, because nothing here knows about pay days.

Another module can post a recurring row (Insurance does). It carries `source`
and `external_id`, unique together, and is written by `write_recurring` and
removed by `delete_recurring`, both guarded like `write_subscription`;
neither touches a detected row. The detector's
unique key on `merchant` is partial (`where source = 'detected'`), so its upsert
cannot overwrite a posted row. The nightly `detect_subscriptions` job moves a
posted row's `next_charge_on` on by its cadence once the date passes. A
quarterly, semiannual or yearly row filed to a category shows on that budget row
as "set aside $X / month" (`setAsideByCategory()`). Cash flow still reads
transactions only.

`categorySeries(chart_months)` returns every expense category at once, about
two hundred numbers at 12 months, so the trend card's select is a re-render
rather than a round trip. Categories with nothing in the whole window are
dropped.

Both reads take `finance.settings.chart_months` (finance-charts phase 3), 3, 6,
12 or 24, default 12, set from the Chart range pills in the Finance band
through tool `set_chart_months`; the column's own check makes a value outside
that set impossible to store. Net worth keeps its own 30 day daily line and
does not read the setting: it answers a different question.

## Guarded, and what is not

`set_budget` and `write_subscription` are guarded. A budget and a subscription
are commitments, so an agent proposes changing one.

`categorise` is **not**, deliberately. It is bookkeeping, it is reversible from
the row itself, and putting hundreds of rows a month through the Review inbox
would make the inbox useless, which is the exact failure a guard has to avoid.
`tag_trip` and `set_trip` are unguarded for the same reason.

## Trips (v1.2 phase 10b)

`transaction.trip_ref` points at a trip's registry row, with its own
provenance in `trip_classified_by`, apart from the category's: `rule` is a
suggestion, `manual` is the owner's answer (a confirm, a change, or a clear to
null) and no rule touches it again. `tag_trip` is the pre-tag rule
(`trip-rule.ts`, tested): a row dated inside a destination's days whose
descriptor holds the city as a whole word, transfers and income skipped. It
first drops the trip's own earlier suggestions, so a moved date does not leave
stale tags. Travel calls it; Finance reads no travel table. The transaction
row's filing panel has a Trip select and, for a suggestion, Confirm trip. The
`spend` seam sums tagged rows for a trip ref and charged rows for an account
ref, refunds netting, transfers and income left out.

## Jobs

`sync_simplefin` takes `{ days }`: the nightly run asks for a 30 day overlap
(90 on the first run), and the band's Pull 90 days button re-asks for the
first-run window. The result names each account's count and oldest date,
because the history limit is the institution's and a 90 day pull can return
less; the band prints that line under the clock.

`snapshot_balances` writes one row per account per night. It is the only reason
the net worth chart can exist: a balance not recorded on the day is gone, and no
amount of transaction history recovers it. A brokerage moves on market change
with no transaction at all.

Then `categorise`, `detect_subscriptions`, and `nightly_digest`.

## Metrics

`finance.net_worth` and `finance.liquid`, both in **dollars**, not cents. A goal
target is typed in dollars, and a metric that silently returned cents would read
as a hundredfold overshoot on the Goals screen.
