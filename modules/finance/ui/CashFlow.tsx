'use client'

import { ActionButton, CardHead, EmptyState } from '@/components/pos'
import { useScrub } from '@/components/pos/LineChart'
import { cn } from '@/lib/utils'
import { balance, compactMoney, flowReadout, signedMoney } from '../money'

// A window of months of income against spending, with what was left over
// drawn across them. Hand rolled SVG in its own file rather than a primitive in charts.tsx:
// there is one caller, and a bar chart with a line over it is the only shape
// this screen needs. The month labels sit outside the SVG so they are not
// stretched by preserveAspectRatio.

export type MonthFlowPoint = { month: string; incomeCents: number; expenseCents: number }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Sep", and "Sep 25" on the first label of a year so its turn is not two identical labels. */
function monthLabel(iso: string, showYear: boolean): string {
  const [year, month] = iso.split('-').map(Number)
  return showYear ? `${MONTHS[month - 1]} ${String(year).slice(2)}` : MONTHS[month - 1]
}

export function CashFlow({
  months,
  accounts,
  onAccounts,
}: {
  months: MonthFlowPoint[]
  /** How many accounts feed the card, so an excluded one is never silent. */
  accounts: { on: number; total: number }
  onAccounts: () => void
}) {
  // Before the early returns: a hook is called on every render or on none.
  const [hover, scrub] = useScrub(months.length, (share) => Math.floor(share * months.length))
  if (months.length === 0) return null

  const head = (meta: string) => (
    <div className="mb-1 flex items-start gap-3">
      <CardHead
        label={`Cash flow · ${months.length} months · ${accounts.on} of ${accounts.total} accounts`}
        meta={meta}
        className="flex-1"
      />
      <ActionButton size="sm" onClick={onAccounts} aria-label="Cash flow accounts">
        Accounts
      </ActionButton>
    </div>
  )

  // A fresh install has the axis and nothing on it. Drawing six flat bars at
  // zero would read as six months of no money at all, which is a claim about
  // the months rather than about the data.
  if (months.every((m) => m.incomeCents === 0 && m.expenseCents === 0)) {
    return (
      <>
        {head('nothing yet')}
        <EmptyState headline="Nothing to compare" className="mt-3 border-0">
          This fills in as transactions arrive. Income and spending are read from each
          transaction&rsquo;s category: money between your own accounts is on neither side.
        </EmptyState>
      </>
    )
  }

  const nets = months.map((m) => m.incomeCents - m.expenseCents)
  const width = 600
  const height = 140

  // The axis has to hold the bars and the net line, and the net line goes
  // below zero in a month that spent more than it earned. Zero is always on it,
  // because a bar chart that does not show its own baseline is a picture.
  const values = months.flatMap((m) => [m.incomeCents, m.expenseCents])
  const hi = Math.max(...values, ...nets, 0)
  // The bars as well as the nets: spending is expense minus credit and goes
  // below zero in a window where a refund outran the month's charges, and a
  // floor taken from the nets alone would draw that bar outside the frame.
  const lo = Math.min(...values, ...nets, 0)
  const span = hi - lo || 1
  const y = (v: number) => height - ((v - lo) / span) * height

  const slot = width / months.length
  const barWidth = Math.min(22, slot * 0.28)
  const gap = 3
  // Income sits left of centre, spending right of it, so a month reads as one
  // pair rather than as two separate series that happen to be near each other.
  const centre = (i: number) => i * slot + slot / 2
  const netLine = nets.map((n, i) => `${centre(i).toFixed(1)},${y(n).toFixed(1)}`).join(' ')

  const thisMonth = months[months.length - 1]
  const net = thisMonth.incomeCents - thisMonth.expenseCents
  const avgNet = Math.round(nets.reduce((sum, n) => sum + n, 0) / nets.length)
  const read = hover === null ? null : flowReadout(months[hover])
  // Every step-th month is labelled, six labels at most at every width: the
  // card is half the page wide on a desktop, so the viewport says nothing
  // about how many fit.
  const step = Math.ceil(months.length / 6)

  // Where zero sits, as a share of the plot from the top. When every month
  // left something over the floor is zero and the bottom tick already says
  // "$0"; when one ran a deficit zero floats, so it gets its own label and any
  // tick close enough to collide with it is left out, the floor included.
  const zeroAt = y(0) / height
  const ticks = [hi, lo + (span * 2) / 3, lo + span / 3, lo]

  return (
    <div className="flex flex-1 flex-col">
      {head(`${signedMoney(net)} this month`)}

      <div className="mt-2 grid flex-1 grid-cols-[1fr_56px]">
        <div className="relative">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Income against spending over ${months.length} months. This month ${balance(
              thisMonth.incomeCents,
            )} in, ${balance(thisMonth.expenseCents)} out, left over ${signedMoney(net)}.`}
            className="block h-full min-h-[150px] w-full cursor-crosshair overflow-visible"
            {...scrub}
          >
            {/* The month being read, behind its bars. */}
            {hover !== null && <rect x={hover * slot} y={0} width={slot} height={height} fill="var(--label)" fillOpacity={0.06} />}

            {[hi, lo + (span * 2) / 3, lo + span / 3].map((v) => (
              <line key={v} x1="0" y1={y(v)} x2={width} y2={y(v)} stroke="var(--separator)" />
            ))}

            {months.map((m, i) => (
              <g key={m.month}>
                <rect
                  x={centre(i) - barWidth - gap / 2}
                  y={Math.min(y(m.incomeCents), y(0))}
                  width={barWidth}
                  height={Math.max(1, Math.abs(y(0) - y(m.incomeCents)))}
                  fill="var(--chart-3)"
                  rx={2}
                />
                <rect
                  x={centre(i) + gap / 2}
                  y={Math.min(y(m.expenseCents), y(0))}
                  width={barWidth}
                  height={Math.max(1, Math.abs(y(0) - y(m.expenseCents)))}
                  fill="var(--chart-1)"
                  rx={2}
                />
              </g>
            ))}

            {/* Zero, drawn over the bars: in a month that ran a deficit the net
              * line crosses it, and that crossing is the whole reading. */}
            <line x1="0" y1={y(0)} x2={width} y2={y(0)} stroke="var(--separator)" vectorEffect="non-scaling-stroke" />

            <polyline
              points={netLine}
              fill="none"
              stroke="var(--secondary-label)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {nets.map((n, i) => (
              <circle key={months[i].month} cx={centre(i)} cy={y(n)} r={2.5} fill="var(--secondary-system-grouped-background)" stroke="var(--secondary-label)" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>

          {read && hover !== null && (
            // Anchored at the slot's near edge, so it opens toward the middle
            // and never past either end of the plot.
            <div
              data-testid="chart-readout"
              aria-hidden
              className="pointer-events-none absolute top-0 z-2 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 whitespace-nowrap rounded-card border border-separator bg-grouped-2 px-2.5 py-1.5 text-caption-1"
              style={
                hover < months.length / 2
                  ? { left: `${(hover / months.length) * 100}%` }
                  : { left: `${((hover + 1) / months.length) * 100}%`, transform: 'translateX(-100%)' }
              }
            >
              <span className="col-span-2 text-secondary-label">{read.month}</span>
              <span className="text-secondary-label">In</span>
              <span className="num text-right text-label">{read.in}</span>
              <span className="text-secondary-label">Out</span>
              <span className="num text-right text-label">{read.out}</span>
              <span className="text-secondary-label">Left over</span>
              <span className={cn('num text-right', read.leftOver === 'flat' ? 'text-label' : read.leftOver.startsWith('+') ? 'text-green-text' : 'text-red-text')}>
                {read.leftOver}
              </span>
            </div>
          )}
          <span role="status" className="sr-only">
            {read ? `${read.month}: in ${read.in}, out ${read.out}, left over ${read.leftOver}` : ''}
          </span>
        </div>

        <div className="relative flex flex-col justify-between pl-3 text-caption-1 text-secondary-label">
          {ticks.map((v, i) => (
            <span key={i} className={cn('num leading-none', lo < 0 && Math.abs(i / 3 - zeroAt) < 0.15 && 'invisible')}>
              {compactMoney(Math.round(v))}
            </span>
          ))}
          {lo < 0 && (
            <span className="num absolute left-3 -translate-y-1/2 leading-none text-secondary-label" style={{ top: `${zeroAt * 100}%` }}>
              $0
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-[1fr_56px]">
        <div
          className="grid text-center text-caption-1 text-secondary-label"
          style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}
        >
          {/* Every month keeps its column, and a thinned one is invisible rather
            * than hidden: display none took it out of the grid and the rest slid
            * left under the wrong bars. Counted from the first so it carries the
            * year. Flex centring lets a label wider than its column overflow
            * both sides evenly instead of running off to the right. */}
          {months.map((m, i) => (
            <span
              key={m.month}
              className={cn('num flex justify-center whitespace-nowrap', i % step !== 0 && 'invisible')}
            >
              {/* The year on the first label of each year, which is January
                * only when January is not thinned out. */}
              {monthLabel(m.month, i === 0 || m.month.slice(0, 4) !== months[i - step]?.month.slice(0, 4))}
            </span>
          ))}
        </div>
        <span />
      </div>

      <div className="label mt-2.5 flex flex-wrap gap-x-[18px] gap-y-2 border-t border-separator pt-2.5 text-caption-1 text-secondary-label">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-xs bg-chart-3" aria-hidden />
          Money in
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-xs bg-chart-1" aria-hidden />
          Money out
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full bg-secondary-label" aria-hidden />
          Left over
        </span>
        <span className="ml-auto">
          Average left over <span className={cn('num', Math.abs(avgNet) < 50 ? 'text-label' : avgNet > 0 ? 'text-green-text' : 'text-red-text')}>{signedMoney(avgNet)}</span> a month
        </span>
      </div>
      <p className="mt-2 text-caption-1 leading-[1.5] text-secondary-label">
        A month above $0 took in more than it spent. Below $0, it spent more. Money between your own accounts is on neither side. A transfer no rule has filed yet may
        still show.
      </p>
    </div>
  )
}
