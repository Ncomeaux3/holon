'use client'

import { useState } from 'react'
import { LineChart } from '@/components/pos'
import { fieldClass } from '@/components/pos/field'
import { cn } from '@/lib/utils'
import { balance, compactMoney, signedMoney } from '../money'

// One expense category's year. Every category's series arrives with the page,
// so changing the select is a re-render and not a round trip: twenty
// categories over twelve months is two hundred numbers.

export type CategorySeriesPoint = { id: string; name: string; months: number[] }

export function CategoryTrend({
  categories,
  months,
}: {
  categories: CategorySeriesPoint[]
  /** The first of each month the series covers, oldest first. */
  months: string[]
}) {
  const [id, setId] = useState(categories[0]?.id ?? '')
  const chosen = categories.find((c) => c.id === id) ?? categories[0]
  if (!chosen) return null

  // spine()'s shape without spine(): every month of the window is already in
  // the series, and a month with no charge in it is a real zero, not a gap.
  const days = chosen.months.map((cents, i) => ({ date: months[i], cents, observed: true }))

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <select
          aria-label="Category"
          value={chosen.id}
          onChange={(e) => setId(e.target.value)}
          className={cn(fieldClass, 'w-auto py-1.5')}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="label text-caption-1 text-secondary-label">
          {balance(chosen.months.reduce((sum, m) => sum + m, 0))} over {months.length} months
        </span>
      </div>

      <LineChart
        name={chosen.name}
        days={days}
        unit="month"
        format={balance}
        formatCompact={(v) => compactMoney(v)}
        formatDelta={(v) => signedMoney(v)}
      />
    </div>
  )
}
