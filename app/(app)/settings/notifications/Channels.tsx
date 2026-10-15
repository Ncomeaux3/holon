'use client'

import { MetricStrip, Switch, useToast } from '@/components/pos'
import { useOptimisticAction } from '@/components/pos/useOptimisticAction'
import type { Channel } from '@/core/notification-rules'
import { cn } from '@/lib/utils'
import type { CellState } from './ChannelGrid'
import { setChannelEverywhere, type ActionResult } from './actions'

type Row = { value: Channel; label: string; sub: string; state: CellState }
type Patch = { value: Channel; state: CellState }

/**
 * The coarse channel switches: each writes its channel onto or off every
 * rule. `some` is a real third state (the amber border the grid uses too),
 * and pressing it turns the channel on everywhere.
 */
export function Channels({ channels }: { channels: Row[] }) {
  const toast = useToast()
  const [shown, run] = useOptimisticAction<Row[], Patch, ActionResult>(channels, (state, patch) =>
    state.map((c) => (c.value === patch.value ? { ...c, state: patch.state } : c)),
  )

  return (
    <MetricStrip className="mt-3 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
      {shown.map((c) => (
        <div key={c.value} className="flex items-center justify-between gap-2.5 px-3.5 py-3">
          <span>
            <span className="block text-footnote text-label">{c.label}</span>
            <span className="text-footnote text-secondary-label">{c.sub}</span>
          </span>
          <Switch
            label={c.label}
            checked={c.state === 'on'}
            className={cn(c.state === 'some' && 'border-orange')}
            onChange={() => {
              const on = c.state !== 'on'
              run({ value: c.value, state: on ? 'on' : 'off' }, async () => {
                const result = await setChannelEverywhere(c.value, on)
                if (result.ok) toast(`${c.label} ${on ? 'on' : 'off'} for every rule.`)
                return result
              })
            }}
          />
        </div>
      ))}
    </MetricStrip>
  )
}
