'use client'

import { DataRow, DataTable, Switch, useToast } from '@/components/pos'
import { useOptimisticAction } from '@/components/pos/useOptimisticAction'
import type { Channel } from '@/core/notification-rules'
import { cn } from '@/lib/utils'
import { setModuleChannel, setModuleDigest, type ActionResult } from './actions'

export type CellState = 'on' | 'off' | 'some'

export type ModuleRow = {
  id: string
  label: string
  digest: CellState
  push: CellState
  inapp: CellState
  triggers: string
  liveCount: number
  ruleCount: number
}

type Field = 'digest' | 'push' | 'inapp'
type Patch = { id: string; field: Field; state: CellState }

/**
 * Module down the side, the three coarse switches across. A cell writes every
 * rule in its row, so `some` is a real third state and pressing it turns the
 * whole row on rather than toggling to the majority.
 */
export function ChannelGrid({ rows, paused }: { rows: ModuleRow[]; paused: boolean }) {
  const toast = useToast()
  const [shown, run] = useOptimisticAction<ModuleRow[], Patch, ActionResult>(rows, (state, patch) =>
    state.map((r) => (r.id === patch.id ? { ...r, [patch.field]: patch.state } : r)),
  )

  const cell = (
    row: ModuleRow,
    field: Field,
    label: string,
    write: (on: boolean) => Promise<ActionResult>,
    note: (on: boolean) => string,
  ) => {
    const state = row[field]
    return (
      <div className="flex items-center gap-2 lg:justify-center">
        {/* Below lg the head is hidden, so the switch names its channel. */}
        <span className="label w-14 text-secondary-label lg:hidden">{label}</span>
        <Switch
          label={`${label} for ${row.label}`}
          checked={state === 'on'}
          onChange={() => {
            const on = state !== 'on'
            run({ id: row.id, field, state: on ? 'on' : 'off' }, async () => {
              const result = await write(on)
              if (result.ok) toast(note(on))
              return result
            })
          }}
          className={cn(state === 'some' && 'border-orange')}
        />
      </div>
    )
  }

  // The three switch columns are headed by their channel; the phone drops the
  // head, so each switch keeps its own "Digest for Finance" name.
  return (
    <DataTable
      className="mt-2"
      cols="1.2fr repeat(3, 56px) 1.6fr"
      head={[
        'Module',
        <span key="d" className="block text-center">
          Digest
        </span>,
        <span key="p" className="block text-center">
          Push
        </span>,
        <span key="i" className="block text-center">
          In-app
        </span>,
        'What triggers it',
      ]}
    >
      {shown.map((row) => (
        <DataRow
          key={row.id}
          // Below lg: a stacked card (module, three named switches, the
          // triggers) rather than DataRow's first-and-last-on-one-line reflow,
          // which put a switch over the trigger text.
          className="text-footnote max-lg:flex max-lg:flex-col max-lg:gap-2"
        >
          <span className={cn('min-w-0 truncate', paused ? 'text-secondary-label' : 'text-label')}>{row.label}</span>

          {cell(
            row,
            'digest',
            'Digest',
            (on) => setModuleDigest(row.id, on),
            (on) => (on ? `${row.label} batches into the morning digest.` : `${row.label} delivers immediately.`),
          )}
          {cell(
            row,
            'push',
            'Push',
            (on) => setModuleChannel(row.id, 'push' satisfies Channel, on),
            (on) => `Push ${on ? 'on' : 'off'} for ${row.label}.`,
          )}
          {cell(
            row,
            'inapp',
            'In-app',
            (on) => setModuleChannel(row.id, 'inapp' satisfies Channel, on),
            (on) => `In-app ${on ? 'on' : 'off'} for ${row.label}.`,
          )}

          <p className="text-footnote min-w-0 text-secondary-label max-lg:text-left!">{row.triggers}</p>
        </DataRow>
      ))}
    </DataTable>
  )
}
