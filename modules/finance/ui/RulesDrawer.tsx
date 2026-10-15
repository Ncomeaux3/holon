'use client'

import { useState, useTransition } from 'react'
import {
  ActionButton,
  Card,
  EmptyState,
  Eyebrow,
  Overlay,
  StatusChip,
  fieldClass,
} from '@/components/pos'
import { HIT } from '@/components/pos/button-classes'
import { cn } from '@/lib/utils'
import { BUILTIN_RULES, learnable, normalise } from '../categorise'
import { balance, transactionAmount } from '../money'
import type { ActionResult } from './actions'

// v1.2 phase 5c. Rules were written by `learn_rule`, read by the nightly job,
// and shown nowhere: a wrong one (apple icloud to Dining, from an e2e run) was
// unreachable. This is the screen for them, and the screen for what they could
// not file.

export type RuleItem = {
  id: string
  pattern: string
  categoryId: string
  categoryName: string
  classifiedBy: string
  confidence: number | null
}

export type UnfiledItem = {
  pattern: string
  label: string
  count: number
  totalCents: number
  /** Newest first. Positive is money out, negative is money in. */
  rows: { descriptor: string; amountCents: number; occurredOn: string; account: string }[]
}

// The last column is a fixed width and not `auto`: the header, a rules row and
// a built-in row put different things in it (nothing, a Delete button, a chip),
// each row is its own grid, and on `auto` every one of them sized its columns
// differently, so the "Files as" label sat 54px off the select it names.
const headRow = 'grid grid-cols-[minmax(0,1fr)_140px_80px] items-center gap-x-3'

/**
 * The drawer's selects.
 *
 * fieldClass with no size overrides, so the text is 16px below md and Safari
 * does not zoom on focus, plus an explicit h-11: the contract asks for 44px
 * controls on the phone and fieldClass's padding alone lands at 42. The cursor
 * is here because app/globals.css gives `pointer` to buttons only, and this
 * drawer is a screen made almost entirely of selects.
 */
const selectClass = `${fieldClass} h-11 cursor-pointer md:h-auto`

/**
 * Whether a rule can be written on this pattern at all.
 *
 * The same test `write_rule` applies. A descriptor with nothing learnable in it
 * (all digits, or too short to be safe) is still listed, because it is money
 * and hiding it would be the bug this list fixes, but offering a control that
 * can only fail is not honest. Filing one of these is a job for the row itself
 * on the Transactions tab, which files the row and not the merchant.
 */
function canFile(pattern: string): boolean {
  return learnable(normalise(pattern))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fullDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

/**
 * Which way the money went, said before the owner picks a category. A rule
 * files on the description alone, so an institution that both pays interest
 * and charges it lands in one group; saying so is what makes the choice safe.
 */
function direction(rows: UnfiledItem['rows']): string {
  const out = rows.filter((r) => r.amountCents > 0).length
  const incoming = rows.filter((r) => r.amountCents < 0).length
  if (incoming === 0) return 'All money out'
  if (out === 0) return 'All money in'
  return `Both ways: ${out} out, ${incoming} in. One rule files all of them; change a single row by hand on the Transactions tab`
}

export function RulesDrawer({
  rules,
  unfiled,
  categories,
  onClose,
  onSave,
  onDelete,
  toast,
}: {
  rules: RuleItem[]
  unfiled: UnfiledItem[]
  categories: { id: string; name: string }[]
  onClose: () => void
  onSave: (
    pattern: string,
    categoryId: string,
    id?: string,
  ) => Promise<ActionResult & { moved?: number }>
  onDelete: (id: string) => Promise<ActionResult & { moved?: number }>
  toast: (message: string) => void
}) {
  const [pending, start] = useTransition()
  // Written the moment a select changes rather than held until a Done, unlike
  // the limits drawer: each change re-files history, so batching them would
  // make one confirmation stand for several different sets of moved rows.
  const [busy, setBusy] = useState<string | null>(null)

  const run = (key: string, action: () => Promise<ActionResult & { moved?: number }>, what: string) => {
    setBusy(key)
    start(async () => {
      const result = await action()
      setBusy(null)
      if (!result.ok) {
        toast(result.error)
        return
      }
      const moved = result.moved ?? 0
      // How many rows moved, every time. A back-file changes past budgets and
      // saying nothing about it is the surprise this drawer exists to avoid.
      toast(
        moved === 0
          ? `${what}, no past rows matched`
          : `${what}, ${moved} transaction${moved === 1 ? '' : 's'} re-filed`,
      )
    })
  }

  return (
    <Overlay
      open
      onClose={onClose}
      eyebrow="Finance / Transactions / Rules"
      title="Rules"
      lede="A rule files every transaction whose description contains its pattern (a three letter one as a whole word). Changing one re-files the history it matches straight away, so past budgets move with it. A row you filed by hand is never touched."
      footer={
        <>
          <span className="label text-caption-1 text-secondary-label">
            {rules.length} of yours · {BUILTIN_RULES.length} built in · {unfiled.length} unfiled
          </span>
          <ActionButton variant="solid" onClick={onClose} disabled={pending}>
            Done <span aria-hidden="true">&rarr;</span>
          </ActionButton>
        </>
      }
    >
      <Eyebrow>Your rules</Eyebrow>
      {rules.length === 0 ? (
        <EmptyState headline="No rules yet" className="mt-2 border-0">
          File a merchant below, or press Always on a transaction you have just filed.
        </EmptyState>
      ) : (
        <>
          <div className={cn(headRow, 'mt-2 border-b border-separator py-[7px]')}>
            <span className="label text-caption-1 text-secondary-label">Pattern</span>
            <span className="label text-caption-1 text-secondary-label">Files as</span>
            <span className="label text-caption-1 text-secondary-label">&nbsp;</span>
          </div>
          {rules.map((r) => (
            <div key={r.id} className={cn(headRow, 'border-b border-separator py-2.5 text-footnote')}>
              <span className="min-w-0">
                <span className="block truncate text-label">{r.pattern}</span>
                <span className="mt-0.5 block text-caption-1 text-secondary-label">
                  <StatusChip tone={r.classifiedBy === 'model' ? 'brand' : 'quiet'}>
                    {r.classifiedBy === 'model'
                      ? r.confidence === null
                        ? 'Model'
                        : `Model ${r.confidence.toFixed(2)}`
                      : 'Yours'}
                  </StatusChip>
                </span>
              </span>
              <select
                value={r.categoryId}
                aria-label={`Category for ${r.pattern}`}
                disabled={pending}
                onChange={(e) =>
                  run(r.id, () => onSave(r.pattern, e.target.value, r.id), `Rule ${r.pattern} moved`)
                }
                className={selectClass}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <ActionButton
                variant="outline"
                size="sm"
                className="justify-self-end"
                disabled={pending}
                onClick={() => run(r.id, () => onDelete(r.id), `Rule ${r.pattern} deleted`)}
              >
                {busy === r.id ? '…' : 'Delete'}
              </ActionButton>
            </div>
          ))}
        </>
      )}

      <Card className="mt-3.5 flex flex-col gap-2.5">
        <Eyebrow>Unfiled merchants</Eyebrow>
        {unfiled.length === 0 ? (
          <p className="text-footnote leading-[1.5] text-secondary-label">
            Every transaction has a category. Nothing to file.
          </p>
        ) : (
          <>
            <p className="text-footnote leading-[1.5] text-secondary-label">
              What no rule matched, biggest first. Filing one writes a rule and moves every row it
              matches at once.
            </p>
            {unfiled.map((u) => (
              <div key={u.pattern} className="border-b border-separator py-2 last:border-0">
                {/* Stacked below md: beside a 140px select the text had 80px
                  * and a wrapped title ran to seven lines. */}
                <div className="grid grid-cols-1 items-center gap-x-3 gap-y-2 text-footnote md:grid-cols-[minmax(0,1fr)_140px_80px] md:gap-y-0">
                  <span className="min-w-0">
                    <span className="block break-words text-label">{u.label}</span>
                    <span className="mt-0.5 block text-caption-1 text-secondary-label">
                      {/* balance(), not money(): money() is absolute by design and a
                        * group where refunds outran charges is a real negative. */}
                      {u.pattern} · {u.count} {u.count === 1 ? 'row' : 'rows'} · {balance(u.totalCents)}
                    </span>
                    <span className="mt-0.5 block text-caption-1 text-secondary-label">{direction(u.rows)}</span>
                  </span>
                  {canFile(u.pattern) ? (
                    <select
                      // Nothing is chosen yet, so the control names the act rather
                      // than pre-selecting a category the owner did not pick.
                      value=""
                      aria-label={`File ${u.label}`}
                      disabled={pending}
                      onChange={(e) =>
                        run(u.pattern, () => onSave(u.pattern, e.target.value), `${u.pattern} filed`)
                      }
                      className={selectClass}
                    >
                      <option value="" disabled>
                        File as…
                      </option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-footnote text-secondary-label">No pattern to learn</span>
                  )}
                  <span className="label justify-self-end text-caption-1 text-secondary-label max-md:empty:hidden">
                    {busy === u.pattern ? '…' : ''}
                  </span>
                </div>
                {/* Native disclosure: the description is often cut short by the
                  * bank, and the date, account and direction are what tell an
                  * interest credit from an interest charge. */}
                <details className="mt-1.5 text-footnote">
                  <summary className={cn(HIT, 'cursor-pointer text-secondary-label')}>
                    Show {u.count === 1 ? 'the transaction' : `${u.count} transactions`}
                  </summary>
                  <ul className="mt-1.5 flex flex-col gap-1.5">
                    {u.rows.map((r, i) => {
                      const amount = transactionAmount(r.amountCents)
                      return (
                        <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
                          <span className="min-w-0">
                            <span className="block break-words text-label">{r.descriptor}</span>
                            <span className="block text-caption-1 text-secondary-label">
                              {fullDate(r.occurredOn)} · {r.account}
                            </span>
                          </span>
                          <span className={cn('num text-right', amount.incoming ? 'text-green-text' : 'text-label')}>
                            {amount.text}
                            <span className="block text-caption-1 text-secondary-label">{amount.incoming ? 'in' : 'out'}</span>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </details>
              </div>
            ))}
          </>
        )}
      </Card>

      <Card className="mt-3.5 flex flex-col gap-2.5">
        <Eyebrow>Built in</Eyebrow>
        <p className="text-footnote leading-[1.5] text-secondary-label">
          These ship with the app and are not editable. A rule you write beats one of these, so
          overriding one is writing your own with the same pattern.
        </p>
        <div className={cn(headRow, 'border-b border-separator py-[7px]')}>
          <span className="label text-caption-1 text-secondary-label">Pattern</span>
          <span className="label text-caption-1 text-secondary-label">Files as</span>
          <span className="label text-caption-1 text-secondary-label">&nbsp;</span>
        </div>
        {BUILTIN_RULES.map((r) => (
          <div
            key={`${r.pattern}-${r.category}`}
            className={cn(headRow, 'border-b border-separator py-2 text-footnote last:border-0')}
          >
            <span className="min-w-0 truncate text-secondary-label">{r.pattern}</span>
            <span className="truncate text-footnote text-secondary-label">{r.category}</span>
            <StatusChip tone="quiet" className="justify-self-end">Built in</StatusChip>
          </div>
        ))}
      </Card>
    </Overlay>
  )
}
