'use client'

import { useState } from 'react'
import { ActionButton, EmptyState, Eyebrow, StatusDot } from '@/components/pos'
import type { DotTone } from '@/components/pos'
import { SwipeRow } from '@/components/pos/SwipeRow'
import { useOptimisticAction } from '@/components/pos/useOptimisticAction'
import { readAlert, readAllAlerts, snoozeAlert, type ActionResult } from './actions'

export type AlertItem = {
  id: string
  title: string
  body: string
  module: string
  via: string
  time: string
  tone: DotTone
  read: boolean
}

type Patch = { id: string; snoozed?: boolean } | 'all'

/**
 * Unread first on opaque grouped rows, then history. History is secondary rather than
 * faded: the design's rule is that a de-emphasised row keeps full opacity so its
 * text and any button inside stay readable.
 */
export function AlertCentre({ alerts: initialAlerts }: { alerts: AlertItem[] }) {
  const [showHistory, setShowHistory] = useState(true)

  // The per-row Read button, the swipes and Mark all read all flip through
  // one optimistic reducer, same shape as Inbox.tsx's act(): a row (or the
  // whole list) leaves the moment it's pressed, reverted with a toast on
  // failure. A snoozed row is gone from the list, not read: the query behind
  // this screen leaves it out until the snooze ends, as the dashboard does.
  const [alerts, run] = useOptimisticAction<AlertItem[], Patch, ActionResult>(
    initialAlerts,
    (state, patch) =>
      patch === 'all'
        ? state.map((a) => ({ ...a, read: true }))
        : patch.snoozed
          ? state.filter((a) => a.id !== patch.id)
          : state.map((a) => (a.id === patch.id ? { ...a, read: true } : a)),
  )

  const unread = alerts.filter((a) => !a.read)
  const history = alerts.filter((a) => a.read)

  const read = (id: string) => run({ id }, () => readAlert(id))
  // The dashboard's shorter snooze, one day, is the swipe's.
  const snooze = (id: string) => run({ id, snoozed: true }, () => snoozeAlert(id, 1))

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <Eyebrow dot={unread.length > 0 ? 'warn' : 'ok'}>
          Alert centre · {unread.length} unread
        </Eyebrow>
        <div className="flex gap-2">
          <ActionButton disabled={unread.length === 0} onClick={() => run('all', readAllAlerts)}>
            Mark all read
          </ActionButton>
          <ActionButton onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? 'Hide history' : 'Show history'}
          </ActionButton>
        </div>
      </div>

      {unread.length === 0 ? (
        <EmptyState headline="Inbox zero">
          Everything raised so far has been read. New alerts land here the moment a rule fires.
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-card">
          {/* One card, as the rules list is. */}
          {unread.map((a) => (
            <SwipeRow
              key={a.id}
              right={{ label: 'Read', onCommit: () => read(a.id) }}
              left={{ label: 'Snooze', onCommit: () => snooze(a.id) }}
            >
              <div className="flex flex-wrap items-start gap-x-3.5 gap-y-2 border-b border-separator bg-grouped-2 px-3 py-3.5">
                <StatusDot tone={a.tone} className="mt-2" />
                <div className="min-w-0 flex-1 basis-[180px] space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-2.5">
                    <span className="label text-accent">{a.module}</span>
                    <span className="text-footnote text-secondary-label">{a.via}</span>
                  </div>
                  <p className="text-body text-label">{a.title}</p>
                  {a.body && <p className="text-footnote text-secondary-label">{a.body}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-footnote num text-secondary-label">{a.time}</span>
                  <ActionButton onClick={() => read(a.id)}>Read</ActionButton>
                </div>
              </div>
            </SwipeRow>
          ))}
        </div>
      )}

      {showHistory && history.length > 0 && (
        <div className="space-y-2 pt-4">
          <Eyebrow>History · {history.length}</Eyebrow>
          <div>
            {history.map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-start gap-x-3.5 gap-y-2 border-b border-separator px-3 py-3"
              >
                <StatusDot tone="idle" className="mt-2" />
                <div className="min-w-0 flex-1 basis-[180px] space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-2.5">
                    <span className="label text-secondary-label">{a.module}</span>
                    <span className="text-footnote text-secondary-label">{a.via}</span>
                  </div>
                  <p className="text-footnote text-secondary-label">{a.title}</p>
                </div>
                <span className="text-footnote num shrink-0 text-secondary-label">{a.time}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
