import { db } from '@/core/db'
import { ownerToday } from '@/core/today'
import { learnFrom } from '../categorise'
import { classify, loadRuleSet } from '../rules'
import { detectRecurring, isStale, type Charge, type ChargeCadence } from '../recurring'
import { rollForward } from '../calendar'
import {
  cashFlowByMonth,
  categorySpend,
  dueSoon,
  getAlertThreshold,
  listAccounts,
  netWorthSeries,
} from '../data'
import { percent } from '../money'
import { spine } from '@/core/series'

export type FinanceDigest = {
  netWorthCents: number
  changeCents: number
  assetsCents: number
  debtCents: number
  /** Due in the next fortnight, and the first of them by name. */
  upcomingCents: number
  upcomingCount: number
  nextCharge: { name: string; inDays: number } | null
  /**
   * Net worth over the last 30 days, in dollars, for the tile's sparkline.
   * One entry per day; null before the first balance was ever recorded, so the
   * tile draws the days it has rather than stretching them over the month.
   */
  netWorthSeries: (number | null)[]
  /** Categories past the alert threshold, and the threshold they were judged by. */
  overBudget: { name: string; percent: number }[]
  alertThreshold: number
  /**
   * This month so far: what arrived less what left, transfers excluded. The
   * tile head's one line, because a net worth that moved says nothing about
   * whether the month is being lived within its means.
   */
  netThisMonthCents: number
  /** Month to date, summed over the categories that have a budget this month. */
  spendCents: number
  budgetCents: number
  unusual: { descriptor: string; amountCents: number; occurredOn: string }[]
}

/** A single charge above this is worth a line in the digest whatever it was. */
const LARGE_CHARGE_CENTS = 50_000

export async function nightlyDigest(): Promise<FinanceDigest> {
  const [accounts, series, spend, upcoming, flow, today, alertThreshold] = await Promise.all([
    listAccounts(),
    netWorthSeries(30),
    categorySpend(),
    // The same read the screen's Upcoming card makes, so the dashboard tile
    // and the screen it links to cannot disagree about what is due.
    dueSoon(14),
    // One month, because the tile needs this month and nothing else.
    cashFlowByMonth(1),
    ownerToday(),
    // SPEC's 80 by default; the owner's own number once the slider has moved.
    getAlertThreshold(),
  ])

  const netWorth = accounts.reduce((sum, a) => sum + Number(a.balance_cents), 0)
  // Spend against budget is only meaningful where a budget exists; a category
  // with no limit this month is neither under nor over anything.
  const budgeted = spend.filter((c) => c.limit_cents)
  const assets = accounts
    .filter((a) => Number(a.balance_cents) > 0)
    .reduce((sum, a) => sum + Number(a.balance_cents), 0)

  // The change comes from the series, not from summing per account deltas: an
  // account opened inside the window has no thirty day balance and would
  // otherwise count its whole balance as growth.
  const days = spine(series, 30, today)
  const firstKnown = days.find((d) => d.observed)?.cents ?? null
  const change = firstKnown === null ? 0 : netWorth - firstKnown

  const { rows: unusual } = await db().query<{
    descriptor: string
    amount_cents: string
    occurred_on: string
  }>(
    `select t.descriptor, t.amount_cents::text, t.occurred_on::text
       from finance.transaction t
       left join finance.category c on c.id = t.category_id
      where t.amount_cents > $1
        and t.occurred_on >= core.today() - 7
        -- Paying a card off is large every month and unusual never.
        and coalesce(c.kind, 'expense') <> 'transfer'
      order by t.amount_cents desc
      limit 5`,
    [LARGE_CHARGE_CENTS],
  )

  return {
    netWorthCents: netWorth,
    changeCents: change,
    assetsCents: assets,
    debtCents: assets - netWorth,
    // Dollars, not cents: the line is a shape, and the numbers beside it are
    // where the precision belongs.
    netWorthSeries: days.map((d) => (d.cents === null ? null : Math.round(d.cents / 100))),
    upcomingCents: upcoming.charges.reduce((sum, c) => sum + c.amountCents, 0),
    upcomingCount: upcoming.charges.length,
    nextCharge: upcoming.charges[0]
      ? {
          name: upcoming.charges[0].name,
          inDays: Math.round(
            (Date.parse(`${upcoming.charges[0].nextChargeOn}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) /
              86_400_000,
          ),
        }
      : null,
    netThisMonthCents: Number(flow[0]?.income_cents ?? 0) - Number(flow[0]?.expense_cents ?? 0),
    spendCents: budgeted.reduce((sum, c) => sum + Number(c.spent_cents), 0),
    budgetCents: budgeted.reduce((sum, c) => sum + Number(c.limit_cents), 0),
    overBudget: spend
      .filter((c) => !c.is_fixed && c.limit_cents)
      .map((c) => ({
        name: c.name,
        percent: percent(Number(c.spent_cents), Number(c.limit_cents)),
      }))
      .filter((c) => c.percent >= alertThreshold),
    alertThreshold,
    unusual: unusual.map((u) => ({
      descriptor: u.descriptor,
      amountCents: Number(u.amount_cents),
      occurredOn: u.occurred_on,
    })),
  }
}

/**
 * Snapshot every account's balance for today.
 *
 * Idempotent by primary key, so running the job twice in a day corrects the
 * snapshot rather than doubling it. This is the only thing that makes the net
 * worth chart possible: a balance not recorded on the day is gone.
 */
export async function snapshotBalances(): Promise<{ accounts: number }> {
  const { rowCount } = await db().query(
    `insert into finance.balance_daily (account_id, on_date, balance_cents)
     select id, core.today(), balance_cents from finance.account where archived = false
     on conflict (account_id, on_date) do update set balance_cents = excluded.balance_cents`,
  )
  return { accounts: rowCount ?? 0 }
}

/**
 * Categorise everything that has no category, rules first.
 *
 * A row the owner touched is never reconsidered: `is_manual` is the system's
 * one inviolable flag, and this job is the most frequent thing that would
 * otherwise trample it.
 *
 * Anything the rules miss is left uncategorised and reachable: the Transactions
 * tab's Uncategorised chip and the Rules drawer's Unfiled list. v1.2 phase 5d
 * adds the model arm here as one batched call over the merchants left, never
 * one call per row, which is the cost the rules-first design exists to avoid.
 */
export async function categoriseNew(): Promise<{ matched: number; unmatched: number }> {
  // The same set the Rules drawer's back-file runs, so a rule cannot mean one
  // thing tonight and another when it was written. The recent card charges the
  // refund matcher needs come with it.
  const ruleSet = await loadRuleSet()

  const { rows } = await db().query<{
    id: string
    descriptor: string
    merchant: string
    amount_cents: string
    account_kind: string
  }>(
    `select t.id, t.descriptor, t.merchant, t.amount_cents::text, a.kind as account_kind
       from finance.transaction t
       join finance.account a on a.id = t.account_id
      where t.category_id is null and t.is_manual = false
      -- ponytail: 607 rows did not fit the 500 this used to be, and a backlog
      -- that clears 500 a night takes two. One update per row at a few
      -- milliseconds is seconds against the cron's maxDuration of 300; batch
      -- it if a pull ever puts tens of thousands here.
      limit 5000`,
  )

  let matched = 0

  for (const row of rows) {
    const category = classify(
      {
        descriptor: row.descriptor,
        merchant: row.merchant,
        amountCents: Number(row.amount_cents),
        accountKind: row.account_kind,
      },
      ruleSet,
    )
    if (!category) continue

    const categoryId = ruleSet.byName.get(category)
    if (!categoryId) continue

    await db().query(
      `update finance.transaction
          set category_id = $2, classified_by = 'rule', confidence = 1
        where id = $1 and is_manual = false`,
      [row.id, categoryId],
    )
    matched++
  }

  return { matched, unmatched: rows.length - matched }
}

/**
 * Learn a rule from a correction the owner made by hand.
 *
 * Called when a transaction is recategorised in the UI. The next charge from
 * the same merchant is then a rule hit rather than a question, which is the
 * whole compounding value of the module.
 */
export async function learnRule(descriptor: string, categoryId: string): Promise<string | null> {
  const { rows } = await db().query<{ name: string }>(
    `select name from finance.category where id = $1`,
    [categoryId],
  )
  if (rows.length === 0) return null

  const rule = learnFrom(descriptor, rows[0].name)
  if (!rule) return null

  await db().query(
    `insert into finance.category_rule (category_id, pattern, is_manual, classified_by)
     values ($1, $2, true, 'human')
     on conflict (pattern, category_id) do update set is_manual = true, classified_by = 'human'`,
    [categoryId, rule.pattern],
  )
  // The pattern, not a boolean: the caller back-files the history it matches,
  // which since v1.2 phase 5c is what writing any rule means.
  return rule.pattern
}

/**
 * Re-run recurring detection over the last year and refresh the table.
 *
 * The detection is rewritten wholesale because it is derived: nothing the owner
 * edits lives in finance.recurring, and a subscription they curate is its own
 * row pointing back at it.
 */
export async function detectSubscriptions(): Promise<{ found: number; stale: number }> {
  const { rows } = await db().query<{ merchant: string; amount_cents: string; occurred_on: string }>(
    `select coalesce(nullif(t.merchant, ''), t.descriptor) as merchant,
            t.amount_cents::text, t.occurred_on::text
       from finance.transaction t
       left join finance.category c on c.id = t.category_id
      where t.occurred_on >= core.today() - 400
        -- A card paid off on the same day each month has every mark of a
        -- subscription and is not one.
        and coalesce(c.kind, 'expense') <> 'transfer'`,
  )

  const charges: Charge[] = rows.map((r) => ({
    merchant: r.merchant,
    amountCents: Number(r.amount_cents),
    occurredOn: r.occurred_on,
  }))

  const found = detectRecurring(charges)

  for (const r of found) {
    await db().query(
      `insert into finance.recurring
         (merchant, amount_cents, cadence, occurrences, last_charge_on, next_charge_on)
       values ($1, $2, $3, $4, $5, $6)
       -- Detected rows only: a premium Insurance posted under the same name
       -- is not the detector's to rewrite.
       on conflict (merchant) where source = 'detected' do update
         set amount_cents = excluded.amount_cents,
             cadence = excluded.cadence,
             occurrences = excluded.occurrences,
             last_charge_on = excluded.last_charge_on,
             next_charge_on = excluded.next_charge_on`,
      [r.merchant, r.amountCents, r.cadence, r.occurrences, r.lastChargeOn, r.nextChargeOn],
    )
  }

  // A posted row (an insurance premium) has no charges for the detector to
  // re-date it from, so once its date passes it moves on by its cadence.
  const { rows: passed } = await db().query<{ id: string; cadence: ChargeCadence; next_charge_on: string; today: string }>(
    `select id, cadence, next_charge_on::text, core.today()::text as today
       from finance.recurring
      where source <> 'detected' and next_charge_on < core.today()`,
  )
  for (const r of passed) {
    await db().query(`update finance.recurring set next_charge_on = $2 where id = $1`, [
      r.id,
      rollForward(r.cadence, r.next_charge_on, r.today),
    ])
  }

  // SPEC: a subscription with no matching charge in two cycles gets flagged.
  const { rows: subs } = await db().query<{
    id: string
    cadence: string
    last_charge_on: string | null
  }>(
    `select s.id, s.cadence, r.last_charge_on::text
       from finance.subscription s
       left join finance.recurring r on r.id = s.recurring_id
      where s.status = 'active'`,
  )

  const { rows: todayRows } = await db().query<{ today: string }>(
    `select core.today()::text as today`,
  )
  const today = todayRows[0].today

  let stale = 0
  for (const sub of subs) {
    if (!sub.last_charge_on) continue
    if (!isStale({ cadence: sub.cadence as 'monthly', lastChargeOn: sub.last_charge_on }, today)) {
      continue
    }
    // Flagged, not cancelled. The charge stopping might mean the card was
    // reissued, and this module does not get to decide you cancelled something.
    await db().query(`update finance.subscription set status = 'paused' where id = $1`, [sub.id])
    stale++
  }

  return { found: found.length, stale }
}
