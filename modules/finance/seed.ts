import { db } from '@/core/db'
import { register } from '@/core/entities'

// Synthetic rows for `pnpm setup --demo`. Upserts on external_id so running it
// twice does not duplicate. Nothing here is personal; this ships in the template.
//
// The transaction history is generated over four months rather than listed,
// because the point of the demo data is that the detector finds the
// subscriptions in it. A hand written list of "subscriptions" the screen then
// displays would prove nothing.

type Account = {
  key: string
  name: string
  institution: string
  kind: 'checking' | 'savings' | 'brokerage' | 'retirement' | 'credit' | 'crypto'
  balanceCents: number
  mask: string
}

const ACCOUNTS: Account[] = [
  { key: 'checking', name: 'Checking', institution: 'Northwind Bank', kind: 'checking', balanceCents: 615_300, mask: '3318' },
  { key: 'savings', name: 'Savings', institution: 'Northwind Bank', kind: 'savings', balanceCents: 2_740_000, mask: '5207' },
  { key: 'brokerage', name: 'Brokerage', institution: 'Harbor Investments', kind: 'brokerage', balanceCents: 5_812_500, mask: '6650' },
  { key: 'retirement', name: 'Retirement', institution: 'Harbor Investments', kind: 'retirement', balanceCents: 12_160_000, mask: '9043' },
  { key: 'credit', name: 'Credit card', institution: 'Northwind Card', kind: 'credit', balanceCents: -187_400, mask: '2471' },
  { key: 'crypto', name: 'Crypto', institution: 'Bluefin Exchange', kind: 'crypto', balanceCents: 498_000, mask: '' },
]

/** Merchants that recur, which is what the detector should find. */
const SUBSCRIPTIONS = [
  { merchant: 'Notely Pro', cents: 1500, day: 8, account: 'credit', category: 'Subscriptions' },
  { merchant: 'CloudBox storage', cents: 399, day: 14, account: 'credit', category: 'Subscriptions' },
  { merchant: 'Neighbourhood Gym', cents: 3900, day: 22, account: 'checking', category: 'Subscriptions' },
  { merchant: 'Hostly', cents: 1900, day: 17, account: 'credit', category: 'Subscriptions' },
  { merchant: 'Landlord rent', cents: 162_000, day: 1, account: 'checking', category: 'Rent' },
]

/** Merchants that do not recur, which the detector must leave alone. */
const ONE_OFFS = [
  { merchant: 'Greenleaf Market', cents: 8412, category: 'Groceries', account: 'checking' },
  { merchant: 'Greenleaf Market', cents: 7658, category: 'Groceries', account: 'checking' },
  { merchant: 'Bulk Club', cents: 13_760, category: 'Groceries', account: 'credit' },
  { merchant: 'Burrito Bar', cents: 1485, category: 'Dining', account: 'credit' },
  { merchant: 'Bean Street Coffee', cents: 645, category: 'Dining', account: 'credit' },
  { merchant: 'Corner Bistro', cents: 5820, category: 'Dining', account: 'credit' },
  { merchant: 'Fuel Stop', cents: 4620, category: 'Gas / Auto', account: 'credit' },
  { merchant: 'Parcel Market', cents: 6319, category: 'Shopping', account: 'credit' },
  { merchant: 'Brightway Store', cents: 4701, category: 'Shopping', account: 'credit' },
  { merchant: 'Airline seat upgrade', cents: 8800, category: 'Travel', account: 'credit' },
  { merchant: 'Sports shop', cents: 4100, category: 'Fitness', account: 'credit' },
  // Income is negative by this module's convention, and must never be detected
  // as a subscription however regular it is.
  { merchant: 'Payroll', cents: -412_000, category: 'Income', account: 'checking' },
]

const BUDGETS: Record<string, number> = {
  Groceries: 60_000,
  Dining: 30_000,
  'Gas / Auto': 20_000,
  Rent: 162_000,
  Subscriptions: 13_000,
  Travel: 40_000,
  Fitness: 10_000,
  Shopping: 25_000,
}

export async function seed(): Promise<number> {
  const accounts = new Map<string, string>()
  for (const a of ACCOUNTS) {
    const { rows } = await db().query<{ id: string }>(
      `insert into finance.account
         (name, institution, kind, in_cash_flow, balance_cents, mask, source, external_id)
       -- The sync job's default: holdings start out of cash flow.
       values ($1, $2, $3, $3::text not in ('brokerage', 'retirement', 'crypto', 'other'), $4, $5, 'demo', $6)
       on conflict (source, external_id) do update
         set balance_cents = excluded.balance_cents, name = excluded.name
       returning id`,
      [a.name, a.institution, a.kind, a.balanceCents, a.mask, a.key],
    )
    accounts.set(a.key, rows[0].id)
    await register({ module: 'finance', entityType: 'account', entityId: rows[0].id, title: a.name, emit: false, classify: false })
  }

  const { rows: categoryRows } = await db().query<{ id: string; name: string }>(
    `select id, name from finance.category`,
  )
  const categories = new Map(categoryRows.map((c) => [c.name, c.id]))

  let written = 0

  const add = async (args: {
    externalId: string
    descriptor: string
    cents: number
    daysAgo: number
    account: string
    /** Null is a row nothing has filed yet, which is what the Rules drawer is for. */
    category: string | null
    pending?: boolean
  }) => {
    await db().query(
      `insert into finance.transaction
         (account_id, descriptor, merchant, amount_cents, occurred_on,
          category_id, classified_by, confidence, pending, source, external_id)
       values ($1, $2, $2, $3, core.today() - $4::int, $5,
               case when $5::uuid is null then null else 'rule' end,
               case when $5::uuid is null then null else 1 end,
               $7, 'demo', $6)
       on conflict (source, external_id) do update
         set amount_cents = excluded.amount_cents, occurred_on = excluded.occurred_on,
             pending = excluded.pending,
             -- The category too, since v1.2 phase 5c: the fixture has a row
             -- nothing has filed, and a screen test that files it would
             -- otherwise leave it filed for every run after.
             category_id = excluded.category_id,
             classified_by = excluded.classified_by,
             confidence = excluded.confidence
         where finance.transaction.is_manual = false`,
      [
        accounts.get(args.account),
        args.descriptor,
        args.cents,
        args.daysAgo,
        args.category === null ? null : (categories.get(args.category) ?? null),
        args.externalId,
        args.pending ?? false,
      ],
    )
    written++
  }

  // Four monthly cycles, so the detector has the three it needs plus one.
  for (const sub of SUBSCRIPTIONS) {
    for (let cycle = 0; cycle < 4; cycle++) {
      await add({
        externalId: `sub-${sub.merchant}-${cycle}`,
        descriptor: sub.merchant,
        // A couple of cents of drift, well inside the ten percent tolerance,
        // so the median is doing real work rather than matching identical rows.
        cents: sub.cents + (cycle === 2 ? 7 : 0),
        daysAgo: cycle * 30 + (sub.day % 7),
        account: sub.account,
        category: sub.category,
      })
    }
  }

  // Everyday spending, scattered so no rhythm emerges.
  const scatter = [1, 4, 9, 16, 23, 2, 6, 12, 19, 27, 3, 11]
  for (const [i, tx] of ONE_OFFS.entries()) {
    for (let repeat = 0; repeat < 3; repeat++) {
      await add({
        externalId: `oneoff-${i}-${repeat}`,
        descriptor: tx.merchant,
        // Amounts wander well past ten percent, which is what keeps a shop you
        // visit often from being read as a bill.
        cents: Math.round(tx.cents * (1 + repeat * 0.35)),
        daysAgo: scatter[(i + repeat * 5) % scatter.length] + repeat * 9,
        account: tx.account,
        category: tx.category,
      })
    }
  }

  // A lived-in current month. Without this the scatter above lands mostly in
  // earlier months, every budget reads near zero, and the screen never shows
  // the state it exists to show: a category running hot with days still to go.
  const THIS_MONTH: {
    merchant: string
    cents: number
    category: string | null
    account: string
    daysAgo: number
    pending?: boolean
  }[] = [
    { merchant: 'Greenleaf Market', cents: 9240, category: 'Groceries', account: 'checking', daysAgo: 1 },
    { merchant: 'Harvest Grocer', cents: 6120, category: 'Groceries', account: 'credit', daysAgo: 3 },
    { merchant: 'Bulk Club', cents: 15_120, category: 'Groceries', account: 'credit', daysAgo: 5 },
    { merchant: 'Corner Bistro', cents: 7210, category: 'Dining', account: 'credit', daysAgo: 2 },
    { merchant: 'Burrito Bar', cents: 1530, category: 'Dining', account: 'credit', daysAgo: 4 },
    { merchant: 'Delivery app', cents: 3890, category: 'Dining', account: 'credit', daysAgo: 6 },
    { merchant: 'Coffee bar', cents: 1245, category: 'Dining', account: 'credit', daysAgo: 1 },
    // Fitness is the one deliberately over its limit, so the warn state and
    // the pace mark past the fill are both on screen in the demo.
    { merchant: 'Sports shop', cents: 6400, category: 'Fitness', account: 'credit', daysAgo: 2 },
    { merchant: 'Fuel Stop', cents: 5210, category: 'Gas / Auto', account: 'credit', daysAgo: 4 },
    { merchant: 'Parcel Market', cents: 8830, category: 'Shopping', account: 'credit', daysAgo: 3 },
    // v1.2 phase 5a. The kinds at work: paying the card off is a transfer on
    // both sides and in no budget; a dining credit nets against Dining; a
    // pending charge waits until it posts.
    { merchant: 'Northwind credit crd autopay', cents: 187_400, category: 'Credit card payment', account: 'checking', daysAgo: 7 },
    { merchant: 'Payment thank you', cents: -187_400, category: 'Credit card payment', account: 'credit', daysAgo: 7 },
    { merchant: 'Card dining credit', cents: -1000, category: 'Dining', account: 'credit', daysAgo: 5 },
    { merchant: 'Taco truck', cents: 1800, category: 'Dining', account: 'credit', daysAgo: 0, pending: true },
    // v1.2 phase 5c. Two branches of one merchant that no rule matches, so the
    // Uncategorised chip has a count and the Rules drawer has a group worth
    // one rule. The store numbers are the point: they are why the unfiled list
    // groups on the learned pattern and not on the stored merchant.
    { merchant: 'RIVER ROAST #4412', cents: 1180, category: null, account: 'credit', daysAgo: 8 },
    { merchant: 'RIVER ROAST #9920', cents: 940, category: null, account: 'credit', daysAgo: 12 },
    // v1.2 phase 10b. A charge with a city in it, for the trip pre-tag rule to
    // find when a trip is in Ghent that day.
    { merchant: 'GRAVENSTEEN CAFE GHENT BE', cents: 6420, category: 'Dining', account: 'credit', daysAgo: 3 },
  ]

  for (const [i, tx] of THIS_MONTH.entries()) {
    await add({
      externalId: `month-${i}`,
      descriptor: tx.merchant,
      cents: tx.cents,
      daysAgo: tx.daysAgo,
      account: tx.account,
      category: tx.category,
      pending: tx.pending,
    })
  }
  // A screen test tags and clears trips on these rows; every run starts untagged.
  await db().query(
    `update finance.transaction set trip_ref = null, trip_classified_by = null where source = 'demo'`,
  )

  for (const [name, limit] of Object.entries(BUDGETS)) {
    const categoryId = categories.get(name)
    if (!categoryId) continue
    await db().query(
      `insert into finance.budget (category_id, month, limit_cents)
       values ($1, date_trunc('month', core.today())::date, $2)
       on conflict (category_id, month) do update set limit_cents = excluded.limit_cents`,
      [categoryId, limit],
    )
  }

  // Thirty one days of balance history, so the net worth chart has a line. A
  // gentle upward drift with the current balance as the last point.
  for (const a of ACCOUNTS) {
    for (let daysAgo = 30; daysAgo >= 0; daysAgo--) {
      // A trend plus a wobble. A perfectly straight line is the one shape real
      // balances never make, and a demo chart that draws one looks like a
      // placeholder rather than data.
      const trend = a.balanceCents * 0.0015 * daysAgo
      const wobble = a.balanceCents * 0.004 * Math.sin(daysAgo * 1.7)
      const drift = Math.round(trend + wobble)
      await db().query(
        `insert into finance.balance_daily (account_id, on_date, balance_cents)
         values ($1, core.today() - $2::int, $3)
         on conflict (account_id, on_date) do update set balance_cents = excluded.balance_cents`,
        [accounts.get(a.key), daysAgo, a.balanceCents - drift],
      )
    }
  }

  // Registered so the demo data exercises search and the event log, the same
  // path a real write takes. Only the subscriptions: registering four hundred
  // transactions would bury every other module in the search index.
  for (const sub of SUBSCRIPTIONS) {
    const { rows } = await db().query<{ id: string }>(
      `insert into finance.subscription
         (name, vendor, amount_cents, cadence, next_charge_on, category_id, source, external_id)
       values ($1, $2, $3, 'monthly', core.today() + $4::int, $5, 'demo', $6)
       on conflict (source, external_id) do update
         set amount_cents = excluded.amount_cents, next_charge_on = excluded.next_charge_on
       returning id`,
      [
        sub.merchant,
        sub.merchant.split(' ')[0],
        sub.cents,
        (sub.day % 13) + 1,
        categories.get(sub.category) ?? null,
        `sub-${sub.merchant}`,
      ],
    )

    await register({
      module: 'finance',
      entityType: 'subscription',
      entityId: rows[0].id,
      title: sub.merchant,
      text: `${sub.cents / 100} monthly`,
    })
  }

  return written
}
