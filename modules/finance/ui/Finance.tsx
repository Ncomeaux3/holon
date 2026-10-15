'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  DataTable,
  DataRow,
  ActionButton,
  CHEVRON,
  Card,
  CardHead,
  Chip,
  EmptyState,
  Eyebrow,
  LineChart,
  MetricStrip,
  MetricTile,
  Overlay,
  PaceBar,
  PillGroup,
  Row,
  RowList,
  STRETCH,
  STRETCH_WRAP,
  StatusChip,
  fieldClass,
  useToast,
} from '@/components/pos'
import { HIT } from '@/components/pos/button-classes'
import { Segments } from '@/components/pos/Segments'
import type { Day } from '@/core/series'
import { useSearchState } from '@/components/pos/searchState'
import { parseNumber } from '@/core/numbers'
import { cn } from '@/lib/utils'
import {
  balance,
  budgetTone,
  compactMoney,
  money,
  percent,
  runningBalance,
  signedMoney,
  transactionAmount,
  type BudgetTone,
} from '../money'
import { monthlyEquivalent, type ChargeCadence } from '../recurring'
import { CashFlow, type MonthFlowPoint } from './CashFlow'
import { CashFlowAccounts } from './CashFlowAccounts'
import { CategoryTrend, type CategorySeriesPoint } from './CategoryTrend'
import { RulesDrawer, type RuleItem, type UnfiledItem } from './RulesDrawer'
import {
  deleteRule,
  learnFor,
  recategorise,
  saveBudget,
  saveCashFlowAccounts,
  saveChartMonths,
  saveRule,
  saveCountPending,
  saveThreshold,
  setSubscriptionStatus,
  type ActionResult,
  searchTransactions,
  setTrip,
} from './actions'

/** What the accounts table's change column means, on the head and on a row with none. */
const CHANGE_NOTE = 'Balance change over the last 30 days. An account added inside that window has no history yet.'

/** What the running balance on the Upcoming card is, and what it is not. */
const BALANCE_NOTE =
  'The largest checking account as it stands now, with each charge above taken off in turn. A projection, not a forecast: nothing here knows about pay days.'

// Five tabs over one dataset, plus two drawer kinds. The tab and the open
// drawer live in the URL, so both survive a refresh and a shared link opens
// what it says it opens.

export type FinanceData = {
  todayIso: string
  /** The Finance setting: a category past this share of its limit is flagged. */
  alertThreshold: number
  /** The Finance setting: pending charges count toward a budget before they post. */
  countPending: boolean
  /** The Finance setting: how many months the cash flow card and the category trend show. */
  chartMonths: number
  /** The integration's label, for the drawer's "Synced nightly from SimpleFIN". */
  provider: string | null
  monthPace: number
  netWorthCents: number
  changeCents: number
  assetsCents: number
  debtCents: number
  /**
   * The 30 day axis from spine(): one entry per day, nulls before the first
   * balance was ever recorded. Not the raw rows, which carry no dates the
   * chart can place and no way to tell a reading from a carried one.
   */
  series: Day[]
  accounts: {
    id: string
    name: string
    institution: string
    kind: string
    balanceCents: number
    changeCents: number | null
    sharePercent: number
    txCount: number
    mask: string
    inCashFlow: boolean
  }[]
  /** Every category, for filing a transaction; budgets are the expense kind only. */
  categories: { id: string; name: string; kind: 'expense' | 'income' | 'transfer' | 'credit' }[]
  budgets: {
    id: string
    name: string
    description: string
    isFixed: boolean
    spentCents: number
    limitCents: number | null
    txCount: number
    /** The monthly equivalent of the category's quarterly, six-monthly and yearly charges. */
    setAsideCents: number
  }[]
  /**
   * What leaves the account in the next fortnight, from both the curated
   * subscriptions and the nightly detections, with the checking balance run
   * down through them.
   */
  upcoming: {
    id: string
    name: string
    vendor: string
    amountCents: number
    nextChargeOn: string
    cadence: ChargeCadence
    /** Only a curated subscription can be cancelled; a detection is derived. */
    isSubscription: boolean
    /** 'detected', 'subscription', or the module that posted it ('insurance'). */
    source: string
  }[]
  /**
   * Where the running balance starts: the largest checking account, or null
   * when there is no checking account to project from.
   */
  checkingCents: number | null
  /** Income against spending per month, oldest first. */
  cashFlow: MonthFlowPoint[]
  /** The first of each month trendCategories covers. */
  trendMonths: string[]
  trendCategories: CategorySeriesPoint[]
  transactions: {
    id: string
    descriptor: string
    amountCents: number
    occurredOn: string
    accountName: string
    categoryName: string | null
    classifiedBy: string | null
    confidence: number | null
    isManual: boolean
    pending: boolean
    tripRef: string | null
    tripTitle: string | null
    /** 'rule' is the pre-tag rule's suggestion, 'manual' the owner's answer. */
    tripClassifiedBy: 'rule' | 'manual' | null
  }[]
  /** The trips a row can be tagged to, from the registry, newest first. */
  trips: { ref: string; title: string }[]
  /** Counted over the whole ledger, not over the rows loaded above. */
  counts: { all: number; uncategorised: number; pending: number }
  rules: RuleItem[]
  unfiled: UnfiledItem[]
}

type TxFilter = 'all' | 'uncategorised' | 'pending'

type Tab = 'overview' | 'accounts' | 'budgets' | 'subscriptions' | 'transactions'

const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'accounts', label: 'Accounts' },
  { value: 'budgets', label: 'Budgets' },
  { value: 'subscriptions', label: 'Subscriptions' },
  { value: 'transactions', label: 'Transactions' },
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const shortDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`)
  return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}`
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const weekday = (iso: string) => DOW[new Date(`${iso}T12:00:00`).getDay()]
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
const inDays = (from: string, to: string) => {
  const n = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n}d`
}
const dayOfMonth = (iso: string) => new Date(`${iso}T12:00:00`).getDate()
const daysLeftInMonth = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`)
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() - d.getDate()
}
const monthLabel = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`)
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** The artboard's card: 1px rule on the elevated ground, 14px 20px inside. */
const overviewCard = 'border-separator px-5 py-3.5'
/** Its rows: 9px; the hover tint is DataRow's own, on the rows that open something. */
const overviewRow = 'lg:min-h-11 lg:py-[9px] lg:gap-y-0'

/** One cell of the KPI strip: eyebrow, 34px figure, an 11px tracked line. */
/** The KPI strip's four cells: the phone's overview summary and the desktop's one-page dashboard share them. */
function KpiStrip({
  data,
  hot,
  upcomingTotal,
  daysLeft,
}: {
  data: FinanceData
  hot: FinanceData['budgets']
  upcomingTotal: number
  daysLeft: number
}) {
  // What the change is measured from: the oldest day an actual balance was
  // recorded, not data.series[0], which is null until the first sync.
  const firstKnown = data.series.find((d) => d.observed)?.cents ?? null

  // The sub-line wraps on the phone, where a cell is half the width and
  // nothing may be cut, and truncates from md.
  const sub = 'num block min-w-0 md:truncate'
  return (
    <>
      <MetricTile
        size="lg"
        label="Net worth"
        value={balance(data.netWorthCents)}
        delta={<span className={sub}>assets {money(data.assetsCents)} · debt {money(data.debtCents)}</span>}
      />
      <MetricTile
        size="lg"
        label="30-day change"
        value={signedMoney(data.changeCents)}
        valueTone={data.changeCents > 0 ? 'ok' : data.changeCents < 0 ? 'bad' : undefined}
        delta={
          <span className={sub}>
            {firstKnown === null
              ? 'no history yet'
              : `${data.changeCents >= 0 ? '+' : ''}${((data.changeCents / Math.max(1, Math.abs(firstKnown))) * 100).toFixed(1)}% · from ${money(firstKnown)}`}
          </span>
        }
      />
      <MetricTile
        size="lg"
        label="Due in 14 days"
        value={money(upcomingTotal, true)}
        delta={
          <span className={sub}>
            {data.upcoming.length > 0
              ? `${data.upcoming.length} ${data.upcoming.length === 1 ? 'charge' : 'charges'} · next ${shortDate(data.upcoming[0].nextChargeOn)}`
              : 'nothing booked'}
          </span>
        }
      />
      <MetricTile
        size="lg"
        label={`Budgets over ${data.alertThreshold}%`}
        value={hot.length}
        valueTone={hot.length > 0 ? 'warn' : undefined}
        delta={
          <span className={sub}>
            {hot.length > 0
              ? `${daysLeft} days left · ${hot.map((b) => b.name).join(' · ')}`
              : `${daysLeft} days left · all within limits`}
          </span>
        }
      />
    </>
  )
}

/** The chart or its empty state: the phone's sparkline card and the desktop's chart card share this. */
function NetWorthCard({ data }: { data: FinanceData }) {
  // One reading draws nothing worth looking at, and none draws a flat line at
  // zero that reads as a balance of zero. Both are the empty state.
  if (data.series.filter((d) => d.observed).length < 1) {
    return (
      <>
        <CardHead label="Net worth · 30 days" meta="no history yet" />
        <EmptyState headline="No history yet" className="mt-3 border-0">
          The chart is built from one balance snapshot per account per night. It fills in
          as the nightly job runs; a balance not recorded on the day is gone.
        </EmptyState>
      </>
    )
  }
  return <NetWorthChart days={data.series} />
}

export function Finance({ data }: { data: FinanceData }) {
  const { params, set: setParams } = useSearchState()
  const tab = (TABS.find((t) => t.value === params.get('tab'))?.value ?? 'overview') as Tab

  const openAccount = data.accounts.find((a) => a.id === params.get('account')) ?? null
  const openBudget = data.budgets.find((b) => b.id === params.get('budget')) ?? null
  // A budget's Spent is a month-to-date sum, so the rows under it are this
  // month's rows in that category and nothing else.
  const monthStart = `${data.todayIso.slice(0, 8)}01`
  const accountTx = openAccount
    ? data.transactions.filter((t) => t.accountName === openAccount.name)
    : []

  const [, start] = useTransition()
  const toast = useToast()
  // The same card on both widths, so the head's count and its drawer are shared.
  const cashFlowAccounts = {
    accounts: { on: data.accounts.filter((a) => a.inCashFlow).length, total: data.accounts.length },
    onAccounts: () => setParams({ cashflow: '1' }, { push: true }),
  }

  const run = (action: () => Promise<ActionResult>, ok?: string) =>
    start(async () => {
      const result = await action()
      if (!result.ok) toast(result.error)
      else if (ok) toast(ok)
    })

  // Like run(), but hands the result back so a caller (recategorise's label,
  // below) can revert its own optimistic state on failure.
  const runFor = (action: () => Promise<ActionResult>, ok?: string): Promise<ActionResult> =>
    new Promise((resolve) => {
      start(async () => {
        const result = await action()
        if (!result.ok) toast(result.error)
        else if (ok) toast(ok)
        resolve(result)
      })
    })

  // Optimistic: the pill moves before the round trip both series need, since
  // they are server reads, and moves back if the save fails.
  const [chartMonths, setChartMonths] = useState(data.chartMonths)

  // One control over both month charts, rendered where each width reads them:
  // on the tab row wide, above the cash flow card on a phone.
  const range = (
    <PillGroup
      label="Chart range"
      value={String(chartMonths)}
      onChange={async (next) => {
        const before = chartMonths
        setChartMonths(Number(next))
        if (!(await runFor(() => saveChartMonths(Number(next)))).ok) setChartMonths(before)
      }}
      options={[
        { value: '3', label: '3m' },
        { value: '6', label: '6m' },
        { value: '12', label: '12m' },
        { value: '24', label: '24m' },
      ]}
    />
  )

  // A cancelled subscription leaves the Upcoming list and its KPI count the
  // moment Cancel is pressed, same shape as Inbox.tsx's act(): optimistic,
  // reverted with a toast on failure.
  const [txFilter, setTxFilter] = useState<TxFilter>('all')
  // The tab holds the newest rows, so a search asks the server for the whole
  // ledger. Two characters before it asks, a quarter second after typing stops.
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<{ q: string; rows: FinanceData['transactions']; more: boolean } | null>(null)
  const q = query.trim()
  const searching = q.length >= 2
  useEffect(() => {
    if (q.length < 2) return
    let live = true
    const timer = setTimeout(() => {
      searchTransactions(q)
        .then((result) => live && setFound({ q, ...result }))
        .catch(() => live && toast('Search failed'))
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q, toast])
  const pool = searching ? (found?.q === q ? found.rows : null) : data.transactions
  const shownTransactions =
    pool === null
      ? []
      : txFilter === 'all'
        ? pool
        : txFilter === 'pending'
          ? pool.filter((t) => t.pending)
          : pool.filter((t) => t.categoryName === null)

  const [gone, setGone] = useState<string[]>([])
  const cancel = (u: FinanceData['upcoming'][number]) => {
    setGone((g) => [...g, u.id])
    start(async () => {
      const result = await setSubscriptionStatus(u.id, 'cancelled')
      if (result.ok) toast(`${u.name} cancelled`)
      else {
        setGone((g) => g.filter((x) => x !== u.id))
        toast(result.error)
      }
    })
  }
  const upcoming = data.upcoming.filter((u) => !gone.includes(u.id))
  const kpiData = gone.length > 0 ? { ...data, upcoming } : data

  const upcomingTotal = upcoming.reduce((sum, u) => sum + u.amountCents, 0)
  // Recomputed here rather than fetched with the charges, so cancelling one
  // corrects every balance below it at once instead of after a reload. With no
  // checking account there is nothing to project from, and the column goes
  // rather than counting every row down from zero into a red number that says
  // the money has run out.
  const projecting = data.checkingCents !== null
  const balanceAfter = runningBalance(data.checkingCents ?? 0, upcoming.map((u) => u.amountCents))
  const hot = data.budgets.filter(
    (b) => !b.isFixed && b.limitCents && percent(b.spentCents, b.limitCents) >= data.alertThreshold,
  )
  const daysLeft = daysLeftInMonth(data.todayIso)
  // What the fortnight's charges cost per month: a yearly one contributes a
  // twelfth, a weekly one four and a third.
  const monthlySubscriptions = upcoming.reduce((sum, u) => sum + monthlyEquivalent(u.amountCents, u.cadence), 0)
  // Twenty expense categories since 5a, most with no limit and nothing in
  // them this month. The lists show the ones that mean something; the limits
  // drawer keeps every one so a limit can be set.
  const shownBudgets = data.budgets.filter((b) => b.limitCents || b.spentCents !== 0 || b.setAsideCents)
  const budgetTotals = data.budgets
    .filter((b) => b.limitCents)
    .reduce((t, b) => ({ spent: t.spent + b.spentCents, limit: t.limit + (b.limitCents ?? 0) }), { spent: 0, limit: 0 })

  return (
    <div className="space-y-5">
      {/* One set of tabs at every width, so a row is found the same way on
        * the desktop as on the phone. Overview is the one view that differs:
        * the desktop keeps its whole-picture page there. */}
      <div>
        <Segments
          label="Finance views"
          value={tab}
          end={tab === 'overview' && <div className="ml-auto hidden md:block">{range}</div>}
          onChange={(next) => setParams({ tab: next === 'overview' ? null : next }, { local: true })}
          tabs={TABS.map((t) => ({
            value: t.value,
            label: t.label,
            count:
              t.value === 'accounts'
                ? data.accounts.length
                : t.value === 'subscriptions'
                  ? upcoming.length
                  : undefined,
          }))}
        >
          {tab === 'overview' && (
            <>
            <div className="mt-[18px] space-y-3.5 md:hidden">
              <MetricStrip>
                <KpiStrip data={kpiData} hot={hot} upcomingTotal={upcomingTotal} daysLeft={daysLeft} />
              </MetricStrip>
              <Card className={cn(overviewCard, 'flex min-h-[260px] flex-col')}>
                <NetWorthCard data={data} />
              </Card>
              {data.cashFlow.length > 0 && (
                <>
                  <div className="flex justify-end">{range}</div>
                  <Card className={cn(overviewCard, 'flex min-h-[240px] flex-col')}>
                    <CashFlow months={data.cashFlow} {...cashFlowAccounts} />
                  </Card>
                </>
              )}
              {data.trendCategories.length > 0 && (
                <Card className={cn(overviewCard, 'flex min-h-[280px] flex-col')}>
                  <CategoryTrend categories={data.trendCategories} months={data.trendMonths} />
                </Card>
              )}
              <RowList>
                <Row
                  title="Accounts"
                  meta={`${data.accounts.length} ${data.accounts.length === 1 ? 'account' : 'accounts'} · ${balance(data.netWorthCents)}`}
                  onClick={() => setParams({ tab: 'accounts' }, { local: true })}
                />
                <Row
                  title="Budgets"
                  meta={`${hot.length} over ${data.alertThreshold}% · ${money(budgetTotals.spent)} spent`}
                  onClick={() => setParams({ tab: 'budgets' }, { local: true })}
                />
                <Row
                  title="Subscriptions"
                  meta={`${upcoming.length} due in 14 days · ${money(upcomingTotal, true)}`}
                  onClick={() => setParams({ tab: 'subscriptions' }, { local: true })}
                />
              </RowList>
            </div>
            <div className="mt-[18px] hidden md:block space-y-3.5">
              {/* POS Finance.dc.html: the whole picture on one page. Four cells on
                * the page ground with 1px rules between, then accounts over the
                * curve beside what is due over the budgets. The phone drills in
                * through its segments; the desktop through the drawers. */}
              <div data-testid="finance-kpis">
                <MetricStrip className="sm:grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))]">
                  <KpiStrip data={kpiData} hot={hot} upcomingTotal={upcomingTotal} daysLeft={daysLeft} />
                </MetricStrip>
              </div>

              {/* The chart owns its own header, because the high, low and average
                * belong beside the title rather than under the line. Full width
                * under the KPIs, as the Holon mockup draws it (docs/design/holon/finance.html). */}
              <Card className={cn(overviewCard, 'flex min-h-[300px] flex-col')}>
                <NetWorthCard data={data} />
              </Card>

              <div className="grid items-start gap-3.5 xl:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-3.5 self-stretch">
                  <Card data-testid="finance-accounts" className={overviewCard}>
                    <CardHead label="Accounts" meta="share of assets" className="mb-1" />
                    <DataTable
                      head={['Account', 'Institution', 'Balance', <span key="30d" title={CHANGE_NOTE}>30d change</span>, 'Share']}
                      cols="minmax(0,1.2fr) minmax(0,.9fr) minmax(0,.9fr) minmax(0,.9fr) minmax(0,1fr)"
                    >
                      {data.accounts.map((a) => (
                        <DataRow key={a.id} onClick={() => setParams({ account: a.id }, { push: true })} className={overviewRow}>
                          <span className="min-w-0 truncate text-footnote text-label">
                            {a.name}
                            <span className="label ml-1.5 text-caption-1 text-secondary-label">{a.txCount} tx →</span>
                          </span>
                          <span className="truncate text-footnote text-secondary-label">{a.institution}</span>
                          <span className="num text-right text-footnote text-label">{balance(a.balanceCents)}</span>
                          <span
                            className={cn(
                              'num text-right text-footnote',
                              a.changeCents === null || a.changeCents === 0
                                ? 'text-secondary-label'
                                : a.changeCents > 0
                                  ? 'text-green-text'
                                  : 'text-red-text',
                            )}
                          >
                            {/* Not tracked is not the same as no change, and must not
                                render as one. */}
                            {a.changeCents === null ? (
                              <span title={CHANGE_NOTE} className="label whitespace-nowrap text-caption-1">no history yet</span>
                            ) : a.changeCents === 0 ? (
                              'flat'
                            ) : (
                              signedMoney(a.changeCents)
                            )}
                          </span>
                          <span className="flex items-center justify-end gap-2">
                            <span className="h-0.5 w-14 bg-fill-3" aria-hidden>
                              <span className="block h-0.5 bg-accent" style={{ width: `${Math.max(0, Math.min(100, a.sharePercent))}%` }} />
                            </span>
                            <span className="num w-[34px] shrink-0 text-right text-caption-1 text-secondary-label">
                              {a.balanceCents > 0 ? `${Math.round(a.sharePercent)}%` : '\u2014'}
                            </span>
                          </span>
                        </DataRow>
                      ))}
                    </DataTable>
                  </Card>

                  {/* v1.2 phase 5b. The corner under the accounts table, which was
                    * empty at 1440 while the column beside it ran on. */}
                  {data.cashFlow.length > 0 && (
                    <Card data-testid="finance-cashflow" className={cn(overviewCard, 'flex min-h-[260px] flex-col')}>
                      <CashFlow months={data.cashFlow} {...cashFlowAccounts} />
                    </Card>
                  )}

                </div>

                <div className="flex min-w-0 flex-col gap-3.5">
                  <Card data-testid="finance-upcoming" className={overviewCard}>
                    <CardHead
                      label="Upcoming · 14 days"
                      meta={`${shortDate(data.todayIso)} → ${shortDate(plusDays(data.todayIso, 14))}`}
                      className="mb-1"
                    />
                    {upcoming.length === 0 ? (
                      <EmptyState headline="Nothing booked" className="border-0">
                        Nothing the detector found, and no subscription you keep, is due in the next
                        fortnight.
                      </EmptyState>
                    ) : (
                      <DataTable
                        head={
                          projecting
                            ? ['Date', 'Charge', 'Amount', <span key="after">Balance after</span>]
                            : ['Date', 'Charge', 'Amount']
                        }
                        cols={projecting ? '82px minmax(0,1fr) auto 96px' : '82px minmax(0,1fr) auto'}
                      >
                        {upcoming.map((u, i) => (
                          <DataRow key={u.id} className={cn(overviewRow, 'md:gap-x-3')}>
                            <span className="num text-footnote text-label">
                              {shortDate(u.nextChargeOn)}
                              <span className="mt-0.5 block text-caption-1 text-secondary-label">
                                {weekday(u.nextChargeOn)} · {inDays(data.todayIso, u.nextChargeOn)}
                              </span>
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-footnote text-label">{u.name}</span>
                              <span className="mt-0.5 block truncate text-caption-1 text-secondary-label">
                                {sourceLabel(u)} · {u.cadence}
                                {u.vendor ? ` · ${u.vendor}` : ''}
                              </span>
                            </span>
                            <span className="flex items-center justify-end gap-2.5">
                              {/* Before the amount, not after it: only some rows
                                  carry a Cancel now, and a button inside the numeric
                                  cell pushed those rows' amounts out of the column.
                                  Not on the artboard either way: cancel has no home
                                  there, and this is the one place a due charge is
                                  named. Only a subscription the owner keeps can be
                                  cancelled, because the nightly job would write a
                                  detection straight back. */}
                              {u.isSubscription && (
                                <ActionButton
                                  size="sm"
                                  variant="quiet"
                                  aria-label={`Cancel ${u.name}`}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    cancel(u)
                                  }}
                                >
                                  Cancel
                                </ActionButton>
                              )}
                              <span className="num text-right text-footnote text-label">{money(u.amountCents, true)}</span>
                            </span>
                            {projecting && (
                              <span
                                className={cn(
                                  'num text-right text-footnote',
                                  balanceAfter[i] < 0 ? 'text-red-text' : 'text-secondary-label',
                                )}
                              >
                                {balance(balanceAfter[i])}
                              </span>
                            )}
                          </DataRow>
                        ))}
                        <DataRow className="border-b-0 md:gap-x-3 md:pb-0.5 md:pt-2.5">
                          <span className="label text-caption-1 text-secondary-label">Total</span>
                          <span className="text-footnote text-secondary-label">
                            {upcoming.length} {upcoming.length === 1 ? 'charge' : 'charges'} ·{' '}
                            {money(monthlySubscriptions, true)}/mo in recurring charges
                          </span>
                          <span className="num text-right text-footnote text-label">{money(upcomingTotal, true)}</span>
                          {projecting && (
                            <span
                              className={cn(
                                'num text-right text-footnote',
                                (balanceAfter.at(-1) ?? 0) < 0 ? 'text-red-text' : 'text-label',
                              )}
                            >
                              {balance(balanceAfter.at(-1) ?? data.checkingCents ?? 0)}
                            </span>
                          )}
                        </DataRow>
                      </DataTable>
                    )}
                    {upcoming.length > 0 && projecting && (
                      <p className="text-footnote mt-2.5 text-secondary-label">{BALANCE_NOTE}</p>
                    )}
                  </Card>

                  <Card data-testid="finance-budgets" className={cn(overviewCard, 'flex flex-col')}>
                    <div className="mb-1 flex items-center justify-between gap-3.5">
                      <Eyebrow>Budgets · {monthLabel(data.todayIso)}</Eyebrow>
                      <span className="flex items-center gap-3.5">
                        <span className={cn('label text-caption-1', hot.length > 0 ? 'text-orange-text' : 'text-secondary-label')}>
                          {hot.length} over {data.alertThreshold}%
                        </span>
                        {/* Rules live with transactions, and the desktop page has no
                          * transactions surface of its own: the drawer's Unfiled
                          * list is how this width reaches what nothing filed. */}
                        <ActionButton size="sm" onClick={() => setParams({ rules: '1' }, { push: true })}>
                          Rules
                        </ActionButton>
                        <ActionButton size="sm" onClick={() => setParams({ limits: '1' }, { push: true })}>
                          Edit limits
                        </ActionButton>
                      </span>
                    </div>
                    {shownBudgets.length === 0 ? (
                      <EmptyState headline="No budgets" className="border-0">
                        A budget is a limit on a category for this month. Set one with Edit limits.
                      </EmptyState>
                    ) : (
                      <>
                        <DataTable head={['Category', 'Spent / limit', 'Used']} cols="minmax(0,1fr) auto 44px">
                          {shownBudgets.map((b) => {
                            const used = b.limitCents ? budgetTone(b.spentCents, b.limitCents, data.alertThreshold, b.isFixed) : null
                            const over = used !== null && (used.tone === 'warn' || used.tone === 'bad')
                            const tone = used === null || used.tone === 'fixed' ? 'text-label' : toneText(used.tone)
                            return (
                              <DataRow
                                key={b.id}
                                onClick={() => setParams({ budget: b.id }, { push: true })}
                                className={cn(overviewRow, 'lg:block lg:py-1.5')}
                              >
                                <span className="grid items-baseline gap-x-3.5 lg:grid-cols-[minmax(0,1fr)_auto_44px]">
                                  <span className={cn('min-w-0 truncate text-footnote', tone)}>
                                    {b.name}
                                    {b.isFixed ? (
                                      <StatusChip tone="quiet" className="ml-1.5">Fixed</StatusChip>
                                    ) : over ? (
                                      <StatusChip tone="warn" className="ml-1.5">over {data.alertThreshold}%</StatusChip>
                                    ) : null}
                                  </span>
                                  <span className="num text-footnote text-secondary-label lg:text-right">
                                    {money(b.spentCents)}{' '}
                                    <span className="text-secondary-label">/ {b.limitCents ? money(b.limitCents) : 'no limit'}</span>
                                    {b.setAsideCents > 0 && (
                                      <span className="block text-caption-1 text-secondary-label">set aside {money(b.setAsideCents)} / month</span>
                                    )}
                                  </span>
                                  <span className={cn('num text-right text-footnote', tone)}>
                                    {used === null ? '\u2014' : `${used.pct}%`}
                                  </span>
                                </span>
                                <BudgetBar budget={b} pace={data.monthPace} threshold={data.alertThreshold} compact />
                              </DataRow>
                            )
                          })}
                        </DataTable>
                        <div className="grid items-baseline gap-x-3.5 pt-2.5 lg:grid-cols-[minmax(0,1fr)_auto_44px]">
                          <span className="label text-caption-1 text-secondary-label">
                            Total · <span className="text-label">{money(Math.max(0, budgetTotals.limit - budgetTotals.spent))} left</span> ·
                            pace mark at day {dayOfMonth(data.todayIso)}
                          </span>
                          <span className="num text-footnote text-label">
                            {money(budgetTotals.spent)} <span className="text-secondary-label">/ {money(budgetTotals.limit)}</span>
                          </span>
                          <span className="num text-right text-footnote text-label">
                            {budgetTotals.limit > 0 ? `${Math.round((budgetTotals.spent / budgetTotals.limit) * 100)}%` : '\u2014'}
                          </span>
                        </div>
                      </>
                    )}
                  </Card>

                  {data.trendCategories.length > 0 && (
                    <Card data-testid="finance-trend" className={cn(overviewCard, 'flex min-h-[300px] flex-col')}>
                      <CategoryTrend categories={data.trendCategories} months={data.trendMonths} />
                    </Card>
                  )}
                </div>
              </div>
            </div>
            </>
          )}

          {tab === 'accounts' && (
            <RowList className="mt-[18px] max-w-3xl">
              {data.accounts.map((a) => (
                <Row
                  key={a.id}
                  title={a.name}
                  meta={`${a.institution}${a.mask ? ` ${a.mask}` : ''} / ${a.txCount} transactions`}
                  onClick={() => setParams({ account: a.id }, { push: true })}
                  right={
                    <>
                      <span className="num text-body text-label">{balance(a.balanceCents)}</span>
                      <span
                        className={cn(
                          'label text-caption-1',
                          a.changeCents === null
                            ? 'text-secondary-label'
                            : a.changeCents > 0
                              ? 'text-green-text'
                              : a.changeCents < 0
                                ? 'text-red-text'
                                : 'text-secondary-label',
                        )}
                      >
                        {/* Not tracked is not the same as no change, and must not
                            render as one. */}
                        {a.changeCents === null ? <span title={CHANGE_NOTE}>no history yet</span> : signedMoney(a.changeCents)}
                      </span>
                    </>
                  }
                >
                  {a.balanceCents > 0 && (
                    <div className="flex items-center gap-2.5">
                      <PaceBar value={a.sharePercent} max={100} className="flex-1" />
                      <span className="label w-9 shrink-0 text-right text-caption-1 text-secondary-label">
                        {Math.round(a.sharePercent)}%
                      </span>
                    </div>
                  )}
                </Row>
              ))}
            </RowList>
          )}

          {tab === 'budgets' && (
            <div className="mt-[18px] max-w-3xl space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className={cn('label text-caption-1', hot.length > 0 ? 'text-orange-text' : 'text-secondary-label')}>
                  {hot.length} over {data.alertThreshold}%
                </span>
                {/* The same drawer the desktop card opens; the phone has no card head to hold it. */}
                <ActionButton size="sm" onClick={() => setParams({ limits: '1' }, { push: true })}>
                  Edit limits
                </ActionButton>
              </div>
              <p className="text-footnote text-secondary-label">
                The tick on each bar is where you would be if you spent evenly through the month. A
                limit you set here applies to this month only, so raising one in March does not rewrite
                what February was measured against.
              </p>
              {shownBudgets.map((b) => {
                const used = b.limitCents ? budgetTone(b.spentCents, b.limitCents, data.alertThreshold, b.isFixed) : null
                const tone = used === null || used.tone === 'fixed' ? null : toneText(used.tone)
                return (
                <Card key={b.id} className={cn(STRETCH_WRAP, 'space-y-2.5')}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <button
                      type="button"
                      onClick={() => setParams({ budget: b.id }, { push: true })}
                      className={cn(STRETCH, 'text-body text-left', tone ?? 'text-label')}
                    >
                      {b.name}
                    </button>
                    <div className="flex items-center gap-2">
                      {b.isFixed && <Chip tone="quiet">Fixed</Chip>}
                      <span className={cn('num text-footnote', tone ?? 'text-secondary-label')}>
                        {money(b.spentCents)}
                        {b.limitCents ? ` of ${money(b.limitCents)}` : ' spent, no limit'}
                      </span>
                      <span aria-hidden="true" className={CHEVRON}>
                        &rsaquo;
                      </span>
                    </div>
                  </div>
                  <BudgetBar budget={b} pace={data.monthPace} threshold={data.alertThreshold} />
                  <p className="text-footnote text-secondary-label">
                    {b.description}
                    {b.setAsideCents > 0 && `${b.description ? ' · ' : ''}set aside ${money(b.setAsideCents)} / month`}
                  </p>
                </Card>
                )
              })}
            </div>
          )}

          {tab === 'subscriptions' && (
            <div className="mt-[18px] max-w-3xl space-y-3">
              {upcoming.length === 0 ? (
                <EmptyState headline="Nothing detected">
                  A subscription is three charges from the same merchant, within ten percent of each
                  other, on a regular cadence. The nightly job promotes what it finds; two charges is a
                  coincidence, not a subscription.
                </EmptyState>
              ) : (
                <RowList>
                  {upcoming.map((u, i) => (
                    <Row
                      key={u.id}
                      title={u.name}
                      meta={`${u.vendor || (u.isSubscription ? 'No vendor' : sourceLabel(u))} / ${u.cadence} / next ${shortDate(u.nextChargeOn)}`}
                      amount={money(u.amountCents, true)}
                      right={
                        <>
                          {u.isSubscription && <ActionButton onClick={() => cancel(u)}>Cancel</ActionButton>}
                        </>
                      }
                    >
                      {projecting ? (
                        <span className="label text-caption-1 text-secondary-label">
                          Leaves {balance(balanceAfter[i])} in checking
                        </span>
                      ) : null}
                    </Row>
                  ))}
                </RowList>
              )}
            </div>
          )}

          {tab === 'transactions' && (
            <div className="mt-[18px] max-w-3xl">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* The counts are the ledger's, not this list's: 607 rows had
                  * no category behind a window of 60, which is why there is a
                  * filter at all. */}
                <PillGroup
                  label="Transaction filter"
                  value={txFilter}
                  onChange={setTxFilter}
                  options={[
                    { value: 'all', label: 'All', count: data.counts.all },
                    { value: 'uncategorised', label: 'Uncategorised', count: data.counts.uncategorised },
                    { value: 'pending', label: 'Pending', count: data.counts.pending },
                  ]}
                />
                {/* ml-auto, not justify-between alone: the three pills fill
                  * the row at 402 and the button wraps, and a wrapped line
                  * with one item on it starts at the left edge. */}
                <ActionButton
                  size="sm"
                  className="ml-auto"
                  onClick={() => setParams({ rules: '1' }, { push: true })}
                >
                  Rules
                </ActionButton>
              </div>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Merchant, category, account or amount"
                aria-label="Search transactions"
                className={cn(fieldClass, 'mt-3 w-full')}
              />
              {searching && pool === null ? (
                <p className="mt-3.5 text-footnote text-secondary-label">Searching…</p>
              ) : searching && shownTransactions.length === 0 ? (
                <EmptyState headline="Nothing matches" className="mt-3.5">
                  No transaction has &ldquo;{q}&rdquo; in its description, category or account, or
                  that amount{txFilter === 'all' ? '' : ' under this filter'}.
                </EmptyState>
              ) : (
              <TransactionList
                transactions={shownTransactions}
                caption={searching ? `Results for “${q}”${found?.more ? ', newest 200, narrow it to see the rest' : ''}` : undefined}
                total={
                  searching
                    ? undefined
                    : txFilter === 'all'
                      ? data.counts.all
                      : txFilter === 'pending'
                        ? data.counts.pending
                        : data.counts.uncategorised
                }
                categories={data.categories}
                onRecategorise={(id, categoryId) => runFor(() => recategorise(id, categoryId), 'Filed')}
                onLearn={(id, categoryId) => runFor(() => learnFor(id, categoryId), 'Rule learned')}
                trips={data.trips}
                onSetTrip={(id, ref) => runFor(() => setTrip(id, ref), ref ? 'Trip saved' : 'Trip cleared')}
              />
              )}
            </div>
          )}
        </Segments>
      </div>

      {openAccount && (
        <Overlay
          open
          onClose={() => setParams({ account: null })}
          eyebrow={`Finance / Accounts / ${openAccount.name}`}
          title={openAccount.name}
          lede={`${openAccount.institution} · balance ${balance(openAccount.balanceCents)} · ${
            openAccount.changeCents === null ? 'new this month' : `${signedMoney(openAccount.changeCents)} over 30 days`
          }. Synced nightly${data.provider ? ` from ${data.provider}` : ''}.`}
        >
          <DrawerStats
            cells={[
              { label: 'Balance', value: balance(openAccount.balanceCents) },
              {
                label: '30-day change',
                value: openAccount.changeCents === null ? 'new' : signedMoney(openAccount.changeCents),
                tone: openAccount.changeCents === null || openAccount.changeCents === 0 ? undefined : openAccount.changeCents > 0 ? 'ok' : 'bad',
              },
              { label: 'In / Out', value: inOut(accountTx) },
            ]}
          />
          <TransactionList
            transactions={accountTx}
            showAccount={false}
            categories={data.categories}
            onRecategorise={(id, categoryId) => runFor(() => recategorise(id, categoryId), 'Filed')}
            onLearn={(id, categoryId) => runFor(() => learnFor(id, categoryId), 'Rule learned')}
            trips={data.trips}
            onSetTrip={(id, ref) => runFor(() => setTrip(id, ref), ref ? 'Trip saved' : 'Trip cleared')}
          />
        </Overlay>
      )}

      {openBudget && (
        <Overlay
          open
          onClose={() => setParams({ budget: null })}
          eyebrow={`Finance / Budgets / ${openBudget.name}`}
          title={openBudget.name}
          lede={`${openBudget.description ? `${openBudget.description}. ` : ''}${
            openBudget.setAsideCents > 0
              ? `Set aside ${money(openBudget.setAsideCents)} / month for charges that do not land monthly. `
              : ''
          }Classified by rules first, model second; every transaction shows which.`}
        >
          <DrawerStats
            cells={[
              { label: 'Spent', value: money(openBudget.spentCents) },
              {
                label: 'Used',
                value: openBudget.limitCents ? `${percent(openBudget.spentCents, openBudget.limitCents)}%` : '\u2014',
                tone: openBudget.limitCents ? statTone(budgetTone(openBudget.spentCents, openBudget.limitCents, data.alertThreshold, openBudget.isFixed).tone) : undefined,
              },
              {
                label: 'Remaining',
                value: openBudget.limitCents ? money(Math.max(0, openBudget.limitCents - openBudget.spentCents)) : '\u2014',
              },
            ]}
          />
          <Card className="mt-3.5 flex items-center gap-3.5">
            <Eyebrow className="flex-1">Monthly limit</Eyebrow>
            <span className="num text-footnote text-secondary-label">$</span>
            <input
              inputMode="decimal"
              defaultValue={openBudget.limitCents ? openBudget.limitCents / 100 : ''}
              aria-label={`Monthly limit for ${openBudget.name}`}
              onBlur={(e) => {
                const n = parseNumber(e.target.value)
                if (n !== null) run(() => saveBudget(openBudget.id, n), 'Limit saved')
              }}
              className={cn(fieldClass, 'num w-24 text-right')}
            />
            <span className="num text-caption-1 text-secondary-label">
              per month
              {openBudget.limitCents
                ? ` · ${money(Math.max(0, Math.round((openBudget.limitCents - openBudget.spentCents) / Math.max(1, daysLeft))))}/day left`
                : ''}
            </span>
          </Card>
          <TransactionList
            transactions={data.transactions.filter(
              (t) => t.categoryName === openBudget.name && t.occurredOn >= monthStart,
            )}
            caption="Transactions · this month"
            categories={data.categories}
            onRecategorise={(id, categoryId) => runFor(() => recategorise(id, categoryId), 'Filed')}
            onLearn={(id, categoryId) => runFor(() => learnFor(id, categoryId), 'Rule learned')}
            trips={data.trips}
            onSetTrip={(id, ref) => runFor(() => setTrip(id, ref), ref ? 'Trip saved' : 'Trip cleared')}
          />
        </Overlay>
      )}

      {params.get('rules') === '1' && (
        <RulesDrawer
          rules={data.rules}
          unfiled={data.unfiled}
          categories={data.categories}
          onClose={() => setParams({ rules: null })}
          onSave={saveRule}
          onDelete={deleteRule}
          toast={toast}
        />
      )}

      {params.get('cashflow') === '1' && (
        <CashFlowAccounts
          accounts={data.accounts}
          onClose={() => setParams({ cashflow: null })}
          onSave={saveCashFlowAccounts}
          toast={toast}
        />
      )}

      {params.get('limits') === '1' && (
        <LimitsDrawer
          budgets={data.budgets}
          threshold={data.alertThreshold}
          countPending={data.countPending}
          onClose={() => setParams({ limits: null })}
          onSave={async (limits, threshold, countPending) => {
            for (const [id, dollars] of limits) {
              const result = await saveBudget(id, dollars)
              if (!result.ok) return result
            }
            if (threshold !== null) {
              const result = await saveThreshold(threshold)
              if (!result.ok) return result
            }
            if (countPending !== null) return saveCountPending(countPending)
            return { ok: true }
          }}
          toast={toast}
        />
      )}
    </div>
  )
}

function BudgetBar({
  budget,
  pace,
  threshold,
  compact = false,
}: {
  budget: FinanceData['budgets'][number]
  pace: number
  threshold: number
  /** The overview's row: the 2px bar with its pace tick and nothing under it. */
  compact?: boolean
}) {
  if (!budget.limitCents) {
    return (
      <p className="text-footnote text-secondary-label">
        No limit set. {money(budget.spentCents)} spent this month.
      </p>
    )
  }

  const { pct, tone, label } = budgetTone(budget.spentCents, budget.limitCents, threshold, budget.isFixed)

  return (
    <div className={cn(!compact && 'space-y-1.5', compact && 'mt-[5px]')}>
      <PaceBar
        value={pct}
        max={100}
        pace={pace}
        tone={tone === 'bad' || tone === 'warn' ? tone : 'brand'}
        className={cn(compact && 'h-0.5 rounded-none [&>div]:rounded-none')}
      />
      {compact ? null : (
        <span className={cn('label block text-caption-1', toneText(tone))}>{label}</span>
      )}
    </div>
  )
}

/** A drawer stat cell only colours trouble: ok and fixed read in ink. */
function statTone(tone: BudgetTone): 'warn' | 'bad' | undefined {
  return tone === 'warn' || tone === 'bad' ? tone : undefined
}

/** The text colour a budget's number and name read in. Fixed costs stay quiet. */
function toneText(tone: BudgetTone): string {
  return tone === 'bad' ? 'text-red-text' : tone === 'warn' ? 'text-orange-text' : tone === 'ok' ? 'text-green-text' : 'text-secondary-label'
}

/**
 * Thirty days of net worth on the shared LineChart (v1.1 Phase 11 extracted
 * it; the drawing is described there). The x axis is thirty days, not thirty
 * rows: before spine() this drew whatever rows the query returned, evenly
 * spaced, so two nights of balances became a line across the full width
 * under a caption reading "30 days".
 */
function NetWorthChart({ days }: { days: Day[] }) {
  return (
    <LineChart
      name="Net worth"
      days={days}
      format={money}
      formatCompact={compactMoney}
      formatDelta={signedMoney}
    />
  )
}

/** "$11.6k / $4.7k": money in and out over the rows shown. */
function inOut(transactions: FinanceData['transactions']): string {
  const inCents = transactions.filter((t) => t.amountCents < 0).reduce((s, t) => s - t.amountCents, 0)
  const outCents = transactions.filter((t) => t.amountCents > 0).reduce((s, t) => s + t.amountCents, 0)
  return `${compactMoney(inCents)} / ${compactMoney(outCents)}`
}

/** The drawer's three cells: one strip, eyebrow over a 24px figure. */
function DrawerStats({
  cells,
}: {
  cells: { label: string; value: string; tone?: 'ok' | 'bad' | 'warn' }[]
}) {
  return (
    <MetricStrip className="grid-cols-3 sm:grid-cols-3">
      {cells.map((c) => (
        <MetricTile key={c.label} size="sm" label={c.label} value={c.value} valueTone={c.tone} className="px-3.5 py-3 sm:px-3.5 sm:py-3" />
      ))}
    </MetricStrip>
  )
}

/**
 * The drawer's transactions, as the artboard draws them: date, merchant with
 * its category and the arm that filed it under, amount with income in green.
 * The category is the control: pressing it opens the picker in the row, and
 * the row stays the artboard's row until then. Every row says which arm
 * decided it, which is the system's rules-first promise made visible.
 */
function TransactionList({
  transactions,
  categories,
  caption = 'Transactions',
  total,
  onRecategorise,
  onLearn,
  trips,
  onSetTrip,
  showAccount = true,
}: {
  transactions: FinanceData['transactions']
  /** Off inside an account's own drawer, whose title already names it. */
  showAccount?: boolean
  /** What this list is: the drawers scope theirs and say so. */
  caption?: string
  /**
   * How many rows exist, when more exist than were loaded. The count line then
   * says so rather than letting the filter chip and the list contradict.
   */
  total?: number
  categories: FinanceData['categories']
  onRecategorise: (id: string, categoryId: string) => Promise<ActionResult>
  onLearn: (id: string, categoryId: string) => Promise<ActionResult>
  trips: FinanceData['trips']
  onSetTrip: (id: string, tripRef: string | null) => Promise<ActionResult>
}) {
  // The trip answer shows the moment it is given, reverted on failure, like
  // the category override below.
  const [tripOverride, setTripOverride] = useState<Record<string, string | null>>({})
  const answerTrip = (id: string, ref: string | null) => {
    setTripOverride((o) => ({ ...o, [id]: ref }))
    onSetTrip(id, ref).then((result) => {
      if (result.ok) return
      setTripOverride((o) => {
        const next = { ...o }
        delete next[id]
        return next
      })
    })
  }
  const [editing, setEditing] = useState<string | null>(null)
  // The category label flips the moment one is picked, reverted on failure,
  // same shape as Inbox.tsx's act() with a map instead of a list.
  const [override, setOverride] = useState<Record<string, string>>({})
  // After a pick, the row offers to make it a rule. The offer stays until
  // answered: a toast would be gone before the owner read it.
  const [offer, setOffer] = useState<{ id: string; categoryId: string; name: string } | null>(null)

  if (transactions.length === 0) {
    return (
      <EmptyState headline="No transactions" className="mt-3.5">
        Nothing here yet. Connect an account at Settings, Connections, and the nightly sync fills
        this in.
      </EmptyState>
    )
  }

  return (
    <div className="mt-3.5">
      <div className="flex items-center justify-between">
        <Eyebrow>{caption}</Eyebrow>
        <span className="label text-caption-1 text-secondary-label">
          {total !== undefined && total > transactions.length
            ? `${transactions.length} of ${total} transactions`
            : `${transactions.length} ${transactions.length === 1 ? 'transaction' : 'transactions'}`}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-[64px_minmax(0,1fr)_auto] gap-x-3 border-b border-separator py-[7px]">
        {['Date', 'Merchant', 'Amount'].map((h, i) => (
          <span key={h} className={cn('label text-caption-1 text-secondary-label', i === 2 && 'text-right')}>
            {h}
          </span>
        ))}
      </div>
      {transactions.map((t) => {
        const amount = transactionAmount(t.amountCents)
        const open = editing === t.id
        // An answer given here is the owner's, so it reads as manual at once.
        const answered = t.id in tripOverride
        const tripRef = answered ? tripOverride[t.id] : t.tripRef
        const tripBy = answered ? 'manual' : t.tripClassifiedBy
        const tripTitle = trips.find((x) => x.ref === tripRef)?.title ?? t.tripTitle
        return (
          <div key={t.id} className="border-b border-separator">
            <div className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-x-3 py-[9px] text-footnote">
              <span className="num text-caption-1 text-secondary-label">{shortDate(t.occurredOn)}</span>
              <span className="min-w-0">
                <span className="block text-label md:truncate">{t.descriptor}</span>
                <span className="mt-0.5 block text-caption-1 text-secondary-label">
                  <button
                    type="button"
                    aria-label={`File ${t.descriptor}`}
                    aria-expanded={open}
                    onClick={() => setEditing(open ? null : t.id)}
                    className={cn(
                      // A text link in a dense row: HIT grows the tap area to 44px without moving the row.
                      HIT,
                      'underline-offset-2 hover:text-label hover:underline',
                      (override[t.id] ?? t.categoryName) ? (t.isManual ? 'text-label' : 'text-secondary-label') : 'text-orange-text',
                    )}
                  >
                    {override[t.id] ?? t.categoryName ?? 'Uncategorised'}
                  </button>{' '}
                  {t.pending && <StatusChip tone="quiet">Pending</StatusChip>}{t.pending ? ' ' : ''}
                  {(t.isManual || t.classifiedBy === 'model' || t.classifiedBy === 'rule') && (
                    <StatusChip tone={t.classifiedBy === 'model' && !t.isManual ? 'brand' : 'quiet'}>
                      {t.isManual
                        ? 'Manual'
                        : t.classifiedBy === 'model' && t.confidence !== null
                          ? `Model ${t.confidence.toFixed(2)}`
                          : t.classifiedBy === 'model'
                            ? 'Model'
                            : 'Rule'}
                    </StatusChip>
                  )}
                  {showAccount && ` · ${t.accountName}`}
                  {/* Last, so a wrap moves the chip and leaves no dot hanging. */}
                  {tripRef && (
                    <>
                      {' '}
                      <StatusChip tone={tripBy === 'rule' ? 'brand' : 'quiet'}>
                        {tripBy === 'rule' ? `${tripTitle}?` : tripTitle}
                      </StatusChip>
                    </>
                  )}
                </span>
              </span>
              <span className={cn('num text-right text-footnote', amount.incoming ? 'text-green-text' : 'text-label')}>
                {amount.text}
              </span>
            </div>
            {open && (
              <div className="flex flex-wrap gap-1.5 pb-2.5">
                {categories.map((c) => (
                  <ActionButton
                    key={c.id}
                    variant={(override[t.id] ?? t.categoryName) === c.name ? 'brand' : 'outline'}
                    onClick={() => {
                      setOverride((o) => ({ ...o, [t.id]: c.name }))
                      setEditing(null)
                      onRecategorise(t.id, c.id).then((result) => {
                        if (!result.ok) {
                          setOverride((o) => {
                            const next = { ...o }
                            delete next[t.id]
                            return next
                          })
                        } else {
                          setOffer({ id: t.id, categoryId: c.id, name: c.name })
                        }
                      })
                    }}
                  >
                    {c.name}
                  </ActionButton>
                ))}
                {trips.length > 0 && (
                  <label className="flex w-full flex-wrap items-center gap-2 pt-1">
                    <span className="text-footnote text-secondary-label">Trip</span>
                    <select
                      aria-label={`Trip for ${t.descriptor}`}
                      value={tripRef ?? ''}
                      onChange={(e) => answerTrip(t.id, e.target.value || null)}
                      className={cn(fieldClass, 'w-auto min-w-0 max-w-full py-1.5')}
                    >
                      <option value="">No trip</option>
                      {trips.map((x) => (
                        <option key={x.ref} value={x.ref}>
                          {x.title}
                        </option>
                      ))}
                    </select>
                    {tripRef && tripBy === 'rule' && (
                      <ActionButton variant="outline" onClick={() => answerTrip(t.id, tripRef)}>
                        Confirm trip
                      </ActionButton>
                    )}
                  </label>
                )}
              </div>
            )}
            {offer?.id === t.id && (
              <div className="flex flex-wrap items-center gap-2 pb-2.5 text-footnote text-secondary-label">
                <span className="min-w-0 flex-1">
                  Always file {t.descriptor} as {offer.name}?
                </span>
                <ActionButton
                  onClick={() => {
                    setOffer(null)
                    onLearn(t.id, offer.categoryId)
                  }}
                >
                  Always
                </ActionButton>
                <ActionButton variant="outline" onClick={() => setOffer(null)}>
                  Not now
                </ActionButton>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * The Budget limits drawer. Edits are held here until Done, as the artboard's
 * Reset and Done imply: the hint counts them, Reset drops them, Done writes
 * them and closes, and leaving with edits asks first.
 */
function LimitsDrawer({
  budgets,
  threshold,
  countPending,
  onClose,
  onSave,
  toast,
}: {
  budgets: FinanceData['budgets']
  threshold: number
  countPending: boolean
  onClose: () => void
  onSave: (
    limits: [string, number][],
    threshold: number | null,
    countPending: boolean | null,
  ) => Promise<ActionResult>
  toast: (message: string) => void
}) {
  const [limits, setLimits] = useState<Record<string, string>>({})
  const [nextThreshold, setNextThreshold] = useState(threshold)
  const [nextCountPending, setNextCountPending] = useState(countPending)
  const [pending, start] = useTransition()

  const changed = Object.entries(limits).flatMap(([id, v]) => {
    const n = parseNumber(v)
    const was = budgets.find((b) => b.id === id)?.limitCents
    return n !== null && Math.round(n * 100) !== (was ?? 0) ? [[id, n] as [string, number]] : []
  })
  const thresholdChanged = nextThreshold !== threshold
  const countPendingChanged = nextCountPending !== countPending
  const count = changed.length + (thresholdChanged ? 1 : 0) + (countPendingChanged ? 1 : 0)

  const done = () =>
    start(async () => {
      const result = await onSave(
        changed,
        thresholdChanged ? nextThreshold : null,
        countPendingChanged ? nextCountPending : null,
      )
      if (!result.ok) {
        toast(result.error)
        return
      }
      if (count > 0) toast(`${count} change${count === 1 ? '' : 's'} saved`)
      onClose()
    })

  const totals = budgets.reduce(
    (t, b) => {
      const edited = limits[b.id] === undefined ? null : parseNumber(limits[b.id])
      const limit = edited !== null ? Math.round(edited * 100) : (b.limitCents ?? 0)
      return { spent: t.spent + b.spentCents, limit: t.limit + limit }
    },
    { spent: 0, limit: 0 },
  )

  return (
    <Overlay
      open
      onClose={onClose}
      dirty={count > 0}
      eyebrow="Finance / Budgets / Settings"
      title="Budget limits"
      lede="Monthly limits per category. Spent this month is shown for reference. Changes apply when you press Done and are never overwritten by a job."
      footer={
        <>
          <span className="label text-caption-1 text-secondary-label">
            {count === 0 ? 'No changes' : `${count} unsaved change${count === 1 ? '' : 's'}`}
          </span>
          <span className="flex gap-2.5">
            <ActionButton variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </ActionButton>
            <ActionButton variant="solid" onClick={done} disabled={pending}>
              Done <span aria-hidden="true">&rarr;</span>
            </ActionButton>
          </span>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_130px] gap-x-3.5 border-b border-separator py-[7px]">
        <span className="label text-caption-1 text-secondary-label">Category</span>
        <span className="label text-right text-caption-1 text-secondary-label">Spent</span>
        <span className="label text-right text-caption-1 text-secondary-label">Monthly limit</span>
      </div>
      {budgets.map((b) => {
        const used = b.limitCents ? budgetTone(b.spentCents, b.limitCents, threshold, b.isFixed) : null
        const tone = used === null || used.tone === 'fixed' ? null : toneText(used.tone)
        return (
          <div key={b.id} className="grid grid-cols-[minmax(0,1fr)_auto_130px] items-center gap-x-3.5 border-b border-separator py-2.5 text-footnote">
            <span className="min-w-0">
              <span className={cn('block truncate', tone ?? 'text-label')}>{b.name}</span>
              <span className="mt-0.5 block truncate text-caption-2 text-secondary-label">
                {b.isFixed && !/^fixed\b/i.test(b.description) ? `Fixed${b.description ? ' · ' : ''}` : ''}
                {b.description}
              </span>
            </span>
            <span className={cn('num text-right text-footnote', tone ?? 'text-secondary-label')}>
              {money(b.spentCents)}
              {used !== null ? ` · ${used.pct}%` : ''}
            </span>
            <span className="flex items-center justify-end gap-1.5">
              <span className="num text-footnote text-secondary-label">$</span>
              <input
                inputMode="decimal"
                value={limits[b.id] ?? (b.limitCents ? String(b.limitCents / 100) : '')}
                onChange={(e) => setLimits((l) => ({ ...l, [b.id]: e.target.value }))}
                aria-label={`Monthly limit for ${b.name}`}
                className={cn(fieldClass, 'num w-[88px] py-1.5 text-right')}
              />
            </span>
          </div>
        )
      })}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_130px] items-center gap-x-3.5 py-3 text-footnote">
        <span className="label text-caption-1 text-secondary-label">Total</span>
        <span className="num text-right text-footnote text-label">{money(totals.spent)}</span>
        <span className="num text-right text-footnote text-label">{money(totals.limit)}</span>
      </div>

      <Card className="mt-2 flex flex-col gap-2.5">
        <Eyebrow>Alert threshold</Eyebrow>
        <div className="flex items-center gap-3.5">
          <input
            type="range"
            min={50}
            max={100}
            step={5}
            value={nextThreshold}
            onChange={(e) => setNextThreshold(Number(e.target.value))}
            aria-label="Alert threshold"
            className="h-11 flex-1 accent-accent"
          />
          <span className="num w-11 text-right text-footnote text-label">{nextThreshold}%</span>
        </div>
        <p className="text-footnote leading-[1.5] text-secondary-label">
          Categories past this share of their limit are flagged in the digest and count toward
          &quot;Budgets over threshold&quot;.
        </p>
      </Card>

      <Card className="mt-2 flex flex-col gap-2.5">
        <Eyebrow>Pending charges</Eyebrow>
        <label className="flex min-h-11 items-center gap-2.5 text-footnote text-label">
          <input
            type="checkbox"
            checked={nextCountPending}
            onChange={(e) => setNextCountPending(e.target.checked)}
            className="accent-accent"
          />
          Count pending charges toward budgets
        </label>
        <p className="text-footnote leading-[1.5] text-secondary-label">
          Off, a charge counts once the bank posts it; the amount and the date can both move
          until then. On, the live number.
        </p>
      </Card>
    </Overlay>
  )
}

/** What a charge in Upcoming is: curated, detected, or posted by another module. */
function sourceLabel(u: { isSubscription: boolean; source: string }): string {
  if (u.isSubscription) return 'Subscription'
  if (u.source === 'detected') return 'Detected'
  return u.source.charAt(0).toUpperCase() + u.source.slice(1)
}
