import { Sparkline } from '@/components/pos'
import type { FinanceDigest } from '../jobs/nightly-digest'

// The Finance dashboard tile, as POS Dashboard.dc.html draws it: two figures
// side by side, net worth with its thirty day move and the fortnight's charges
// with the next one named, then thirty days of net worth as a line. The module
// says how its own numbers read, because core cannot: it has no idea what
// `netWorthCents` is.

const money = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

/** Signed, because a net worth change reads wrong without its direction. */
const delta = (cents: number) => `${cents >= 0 ? '+' : '-'}${money(Math.abs(cents))}`

export function FinanceTile({ payload }: { payload: Record<string, unknown> }) {
  const d = payload as Partial<FinanceDigest>
  const netWorth = d.netWorthCents ?? 0
  const change = d.changeCents ?? 0
  const upcoming = d.upcomingCents ?? 0
  // The digest keeps the nulls so the shape of the month is honest; the
  // sparkline has no way to break a line, so it draws the days there are.
  const series = (d.netWorthSeries ?? []).filter((v): v is number => v !== null)
  const next = d.nextCharge ?? null

  return (
    <div className="flex flex-1 flex-col">
      <div className="mt-0.5 grid grid-cols-2 gap-[18px]">
        <div>
          <span className="block text-caption-1 text-secondary-label">Net worth</span>
          <span className="num mt-1.5 block text-title-2 font-semibold text-label">
            {money(netWorth)}
          </span>
          <span className={`num mt-1.5 block text-caption-1 ${change >= 0 ? 'text-green-text' : 'text-red-text'}`}>
            {delta(change)} · 30d
          </span>
        </div>

        <div>
          <span className="block text-caption-1 text-secondary-label">Due in 14 days</span>
          <span className="num mt-1.5 block text-title-2 font-semibold text-label">
            {money(upcoming)}
          </span>
          <span className="num mt-1.5 block truncate text-caption-1 text-secondary-label">
            {next
              ? `next: ${next.name} · ${next.inDays === 0 ? 'today' : `in ${next.inDays}d`}`
              : `${d.upcomingCount ?? 0} ${d.upcomingCount === 1 ? 'charge' : 'charges'}`}
          </span>
        </div>
      </div>

      {/* The artboard's line under the two numbers: thirty days of net worth,
        * unlabelled, because the number above it is the one that matters and
        * this is only its direction. */}
      {series.length > 1 && <Sparkline points={series} height={56} className="mt-3.5 flex-1" />}
    </div>
  )
}
