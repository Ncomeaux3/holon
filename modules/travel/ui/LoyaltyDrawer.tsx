'use client'

import { useState, useTransition } from 'react'
import { DataRow, DataTable, Eyebrow, Overlay, fieldClass, useToast } from '@/components/pos'
import { parseNumber } from '@/core/numbers'
import { cn } from '@/lib/utils'
import { centsPerPoint } from '../globe'
import { linkLoyaltyAccount, saveLoyalty } from './actions'
import { money, type TravelData } from './Travel'

// Behind the strip's Manage: every balance as a number you type (no loyalty
// site is scraped, per SPEC), and the cents-per-point calculator over two
// numbers you supply.

export function LoyaltyDrawer({
  loyalty,
  accounts,
  monthLabel,
  onClose,
}: {
  loyalty: TravelData['loyalty']
  accounts: TravelData['accounts']
  monthLabel: string
  onClose: () => void
}) {
  const [, start] = useTransition()
  const toast = useToast()
  const [cash, setCash] = useState('')
  const [points, setPoints] = useState('')
  // The linked card shows at once and goes back if the write fails, as the
  // Trip select on a transaction does.
  const [linked, setLinked] = useState<Record<string, string>>({})
  const cpp = centsPerPoint(Math.round((parseNumber(cash) ?? 0) * 100), parseNumber(points) ?? 0)

  return (
    <Overlay
      open
      onClose={onClose}
      eyebrow="Travel / Loyalty"
      title="Loyalty"
      lede="Balances you type; no programme publishes an API worth reading. The move shown in the strip is against the last figure you entered."
    >
      <DataTable head={['Program', 'Balance']} cols="minmax(0,1fr) 130px">
        {loyalty.map((p) => (
          <DataRow key={p.id}>
            <span className="min-w-0">
              <span className="block truncate text-label">{p.name}</span>
              <span className="mt-0.5 block text-footnote text-secondary-label">{[p.kind, p.statusTier].filter(Boolean).join(' · ')}</span>
              {accounts.length > 0 && (
                <span className="mt-1.5 flex flex-wrap items-center gap-2">
                  <label className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-footnote text-secondary-label">Earned on</span>
                    <select
                      value={linked[p.id] ?? p.accountRef ?? ''}
                      aria-label={`Card that earns ${p.name}`}
                      onChange={(e) => {
                        const ref = e.target.value || null
                        const before = linked[p.id] ?? p.accountRef ?? ''
                        setLinked((l) => ({ ...l, [p.id]: e.target.value }))
                        start(async () => {
                          const result = await linkLoyaltyAccount(p.id, ref)
                          if (!result.ok) setLinked((l) => ({ ...l, [p.id]: before }))
                          toast(result.ok ? (ref ? 'Card linked' : 'Card unlinked') : result.error)
                        })
                      }}
                      className={cn(fieldClass, 'w-auto min-w-0 max-w-40 py-1.5')}
                    >
                      <option value="">No card</option>
                      {accounts.map((a) => (
                        <option key={a.ref} value={a.ref}>
                          {a.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {p.lastMonthCents !== null && (
                    <span className="num text-footnote text-secondary-label">
                      {monthLabel} spend {money(p.lastMonthCents)}
                    </span>
                  )}
                </span>
              )}
            </span>
            <input
              inputMode="decimal"
              defaultValue={p.balance}
              aria-label={`${p.name} balance`}
              onBlur={(e) => {
                const next = parseNumber(e.target.value)
                if (next === null || next === p.balance) return
                start(async () => {
                  const result = await saveLoyalty(p.name, next, p.kind as 'airline' | 'hotel' | 'card' | 'rail')
                  toast(result.ok ? `${p.name} saved` : result.error)
                })
              }}
              className={cn(fieldClass, 'num w-[130px] max-w-full py-1.5 text-right')}
            />
          </DataRow>
        ))}
      </DataTable>

      <div className="mt-5 rounded-card bg-grouped-2 px-3.5 py-3">
        <div className="flex items-baseline justify-between">
          <Eyebrow>Cents per point</Eyebrow>
          <Eyebrow>Both numbers yours</Eyebrow>
        </div>
        <p className="mt-2 text-footnote text-secondary-label">
          What the cash fare would have been, against the points it would cost. Above about 1.5
          cents a point is usually worth spending them; below it, pay cash and keep the points.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <label className="space-y-1.5">
            <Eyebrow>Cash fare</Eyebrow>
            <input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} aria-label="Cash fare in dollars" placeholder="640" className={cn(fieldClass, 'w-full')} />
          </label>
          <label className="space-y-1.5">
            <Eyebrow>Points</Eyebrow>
            <input inputMode="decimal" value={points} onChange={(e) => setPoints(e.target.value)} aria-label="Points required" placeholder="35000" className={cn(fieldClass, 'w-full')} />
          </label>
        </div>
        <div className="mt-3 flex items-baseline gap-2.5">
          <span className="num text-title-2 leading-none text-label">{cpp === null ? '--' : `${cpp.toFixed(2)}c`}</span>
          <span className={cn('text-footnote', cpp === null ? 'text-secondary-label' : cpp >= 1.5 ? 'text-green-text' : 'text-orange-text')}>
            {cpp === null ? 'Enter both' : cpp >= 1.5 ? 'Worth using points' : 'Pay cash'}
          </span>
        </div>
      </div>
    </Overlay>
  )
}
