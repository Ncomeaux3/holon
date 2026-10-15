'use client'

import { useState, useTransition } from 'react'
import { ActionButton, Eyebrow, Overlay, Switch } from '@/components/pos'
import { balance } from '../money'
import type { ActionResult } from './actions'

// finance-charts phase 1. Which accounts the cash flow card counts, all of
// them on one screen, because a kind rule cannot tell a spending account from
// a holding and a switch per account drawer would never show the whole
// picture. Held until Done, like the limits drawer, since a save re-reads the
// chart.

export type CashFlowAccount = {
  id: string
  name: string
  institution: string
  kind: string
  balanceCents: number
  inCashFlow: boolean
}

/** Cash first, then holdings, the order the question is usually answered in. */
const KINDS = ['checking', 'savings', 'credit', 'brokerage', 'retirement', 'crypto', 'other']

export function CashFlowAccounts({
  accounts,
  onClose,
  onSave,
  toast,
}: {
  accounts: CashFlowAccount[]
  onClose: () => void
  onSave: (accountIds: string[]) => Promise<ActionResult>
  toast: (message: string) => void
}) {
  const [on, setOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(accounts.map((a) => [a.id, a.inCashFlow])),
  )
  const [pending, start] = useTransition()

  const count = accounts.filter((a) => on[a.id] !== a.inCashFlow).length
  const feeding = accounts.filter((a) => on[a.id]).length

  const done = () =>
    start(async () => {
      if (count > 0) {
        const result = await onSave(accounts.filter((a) => on[a.id]).map((a) => a.id))
        if (!result.ok) {
          toast(result.error)
          return
        }
        toast(`${count} change${count === 1 ? '' : 's'} saved`)
      }
      onClose()
    })

  const groups = KINDS.map((kind) => ({ kind, rows: accounts.filter((a) => a.kind === kind) })).filter(
    (g) => g.rows.length > 0,
  )

  return (
    <Overlay
      open
      onClose={onClose}
      dirty={count > 0}
      eyebrow="Finance / Cash flow"
      title="Cash flow accounts"
      lede="The cash flow card counts money in and out of these accounts only. Turn off anything that holds money rather than spends it, such as investments and retirement. Budgets and net worth still read every account."
      footer={
        <>
          <span className="label text-caption-1 text-secondary-label">
            {feeding} of {accounts.length} feed cash flow
            {count > 0 ? ` · ${count} unsaved` : ''}
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
      {groups.map((g) => (
        <section key={g.kind} className="mt-3 first:mt-0">
          <Eyebrow>{g.kind.charAt(0).toUpperCase() + g.kind.slice(1)}</Eyebrow>
          {g.rows.map((a) => (
            <div
              key={a.id}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3.5 border-b border-separator py-2.5 text-footnote"
            >
              <span className="min-w-0">
                <span className="block truncate text-label">{a.name}</span>
                {a.institution && <span className="mt-0.5 block truncate text-caption-1 text-secondary-label">{a.institution}</span>}
              </span>
              <span className="num text-right text-footnote text-secondary-label">{balance(a.balanceCents)}</span>
              <Switch
                checked={on[a.id]}
                onChange={(next) => setOn((o) => ({ ...o, [a.id]: next }))}
                label={`Count ${a.name} in cash flow`}
              />
            </div>
          ))}
        </section>
      ))}
    </Overlay>
  )
}
