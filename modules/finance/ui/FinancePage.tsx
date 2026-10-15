import { PageHeader, SyncBand } from '@/components/pos'
import { syncState } from '@/core/sync'
import { getSettings } from '@/core/settings'
import { ownerToday } from '@/core/today'
import {
  cashFlowByMonth,
  categorySeries,
  categorySpend,
  dueSoon,
  setAsideByCategory,
  getAlertThreshold,
  getChartMonths,
  getCountPending,
  lastPullDetail,
  listAccounts,
  listCategories,
  listRules,
  listTransactions,
  listTripOptions,
  netWorthSeries,
  transactionCounts,
  transactionItem,
} from '../data'
import { unfiledMerchants } from '../rules'
import { monthPace } from '../money'
import { spine } from '@/core/series'
import { Finance, type FinanceData } from './Finance'
import { pullFinance, syncFinance } from './sync'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Fri Sep 11", the artboard's band date. */
function bandDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export default async function FinancePage() {
  // Both series take the window as an argument, so they chain on this one read
  // inside the batch rather than waiting for it ahead of everything else.
  const months = getChartMonths()
  const [
    accounts,
    series,
    spend,
    categories,
    due,
    cashFlow,
    trend,
    transactions,
    monthTransactions,
    uncategorisedTransactions,
    counts,
    rules,
    unfiled,
    todayIso,
    sync,
    alertThreshold,
    countPending,
    lastPull,
    settings,
    chartMonths,
    trips,
    setAside,
  ] = await Promise.all([
    listAccounts(),
    netWorthSeries(30),
    categorySpend(),
    listCategories(),
    dueSoon(14),
    months.then(cashFlowByMonth),
    months.then(categorySeries),
    listTransactions({ limit: 60 }),
    // This month in full, because a budget drawer lists the rows behind its
    // Spent figure and that figure is a month-to-date sum. Filtering the 60
    // most recent by category left the drawer empty whenever newer rows had
    // pushed the month's charge out of that window, which is what rent did.
    listTransactions({ thisMonth: true, limit: 1000 }),
    // v1.2 phase 5c. The Uncategorised chip's rows, which are mostly older
    // than either window above: 607 of the owner's 622 rows had no category
    // and the tab's 60 most recent could not reach them.
    // Bounded well below the month window above: every row here is serialised
    // into the client component, the list that shows them is inside the phone's
    // `md:hidden` block, and the chip's count is the ledger's either way, so
    // the list says "200 of 607" rather than claiming it holds them all.
    listTransactions({ uncategorised: true, limit: 200 }),
    transactionCounts(),
    listRules(),
    unfiledMerchants(),
    ownerToday(),
    syncState('finance'),
    getAlertThreshold(),
    getCountPending(),
    lastPullDetail(),
    getSettings(),
    months,
    listTripOptions(),
    setAsideByCategory(),
  ])

  const netWorth = accounts.reduce((sum, a) => sum + Number(a.balance_cents), 0)
  const assets = accounts
    .filter((a) => Number(a.balance_cents) > 0)
    .reduce((sum, a) => sum + Number(a.balance_cents), 0)

  // One entry per day of the window, so two days of history draw as two days
  // and not as a month.
  const days = spine(series, 30, todayIso)
  // Measured from the series, not from per account deltas: an account opened
  // inside the window has no thirty day balance, and counting its whole
  // balance as growth would put a number on the screen that never happened.
  const firstKnown = days.find((d) => d.observed)?.cents ?? null
  const change = firstKnown === null ? 0 : netWorth - firstKnown

  const data: FinanceData = {
    todayIso,
    alertThreshold,
    countPending,
    chartMonths,
    provider: sync.provider,
    monthPace: monthPace(todayIso),
    netWorthCents: netWorth,
    changeCents: change,
    assetsCents: assets,
    debtCents: assets - netWorth,
    series: days,

    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      institution: a.institution,
      kind: a.kind,
      balanceCents: Number(a.balance_cents),
      // Null means it was not being tracked thirty days ago, which is not the
      // same as no change and must not render as one.
      changeCents:
        a.balance_30d_cents === null ? null : Number(a.balance_cents) - Number(a.balance_30d_cents),
      sharePercent: assets > 0 ? Math.max(0, (Number(a.balance_cents) / assets) * 100) : 0,
      txCount: Number(a.tx_count),
      mask: a.mask,
      inCashFlow: a.in_cash_flow,
    })),

    // Every category, for filing. Budgets below are the expense kind only.
    categories: categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind })),

    budgets: spend.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      isFixed: c.is_fixed,
      spentCents: Number(c.spent_cents),
      limitCents: c.limit_cents === null ? null : Number(c.limit_cents),
      txCount: Number(c.tx_count),
      setAsideCents: setAside.get(c.id) ?? 0,
    })),

    // Both sources: what the owner curated and what the detector found, with
    // the checking balance run down through them.
    upcoming: due.charges,
    checkingCents: due.checkingCents,

    cashFlow: cashFlow.map((m) => ({
      month: m.month,
      incomeCents: Number(m.income_cents),
      expenseCents: Number(m.expense_cents),
    })),
    trendMonths: trend.months,
    trendCategories: trend.categories,

    trips,
    counts,
    rules: rules.map((r) => ({
      id: r.id,
      pattern: r.pattern,
      categoryId: r.category_id,
      categoryName: r.category_name,
      classifiedBy: r.classified_by,
      confidence: r.confidence === null ? null : Number(r.confidence),
    })),
    unfiled,

    // The union, by id: the newest rows for the Transactions tab, every row of
    // this month for the drawers, and everything unfiled for the chip.
    transactions: (() => {
      const seen = new Set(transactions.map((t) => t.id))
      const union = [...transactions]
      for (const row of [...monthTransactions, ...uncategorisedTransactions]) {
        if (seen.has(row.id)) continue
        seen.add(row.id)
        union.push(row)
      }
      return union
    })()
      // Newest first across the two queries. Array.sort is stable, so rows on
      // the same day keep the order the database gave them.
      .sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : a.occurred_on > b.occurred_on ? -1 : 0))
      .map(transactionItem),
  }

  const hot = data.budgets.filter(
    (b) => !b.isFixed && b.limitCents && (b.spentCents / b.limitCents) * 100 >= alertThreshold,
  ).length

  // SyncBand's own reading (provider, last pull) is `hidden md:inline-flex`,
  // so the same element used as the phone action shows the button alone.
  const syncBand = (
    <SyncBand
      provider={sync.provider}
      at={sync.at}
      status={sync.status}
      connected={sync.connected}
      // What the last pull returned per account: the institution's history
      // limit, not the bridge's, so the count is the honest number.
      note={sync.connected ? lastPull : null}
      timeZone={settings.timezone}
      onSync={syncFinance}
      also={{ label: 'Pull 90 days', run: pullFinance }}
    />
  )

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Finance"
        // The artboard puts the provider and the last pull in the first band,
        // beside the search, with the button that does it now.
        status={syncBand}
        phoneAction={syncBand}
        title="Finance"
        lede="Balances, upcoming charges, and budgets. Synced nightly, amounts in USD."
        // A reading, not a button, so it stays off the phone's action slot.
        actions={
          <span className="label hidden text-secondary-label md:inline">
            {bandDate(todayIso)} · {data.accounts.length} accounts · {hot} {hot === 1 ? 'flag' : 'flags'}
          </span>
        }
      />
      <Finance data={data} />
    </div>
  )
}
