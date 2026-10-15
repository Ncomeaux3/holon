'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { ActionButton, useToast } from '@/components/pos'
import { HIT } from '@/components/pos/button-classes'
import { cn } from '@/lib/utils'
import { readAlert, snoozeAlert } from './notifications/actions'
import { approveProposal, dismissProposal } from './review/actions'

// The rows of the Needs attention band, the ones you act on without leaving
// Today. Both call the same server actions their own screens do, so a
// decision made here and a decision made there are the same write. Nothing
// is a dashboard only code path.

/** A row in the band: a hairline above every row but the first. */
const ROW =
  'flex flex-wrap items-start gap-x-3 gap-y-2 px-1 py-2.5 ' +
  'border-t border-separator first:border-t-0'

export function WarningList({
  warnings,
  phoneLimit,
}: {
  warnings: { id: string; title: string; sub: string; urgent: boolean; href: string | null }[]
  /** Rows shown below md; the rest sit behind a link, so Today fits in two swipes. */
  phoneLimit?: number
}) {
  const [gone, setGone] = useState<string[]>([])
  const [asking, setAsking] = useState<string | null>(null)
  const [, start] = useTransition()
  const toast = useToast()

  // Optimistic, and it stays gone: the row is removed here the moment the
  // action is sent, and the server revalidation confirms it a beat later. A
  // failure puts it back and says why.
  const act = (id: string, run: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setGone((g) => [...g, id])
    setAsking(null)
    start(async () => {
      const result = await run()
      if (!result.ok) {
        setGone((g) => g.filter((x) => x !== id))
        toast(result.error)
      }
    })
  }

  const shown = warnings.filter((w) => !gone.includes(w.id))

  if (shown.length === 0) {
    return <p className="px-1 py-2.5 text-footnote text-secondary-label">No warnings open.</p>
  }

  return (
    <div className="mt-2 flex flex-col">
      {shown.map((w, i) => (
        <div
          key={w.id}
          data-testid="warning-row"
          className={cn(ROW, phoneLimit !== undefined && i >= phoneLimit && 'max-md:hidden')}
        >
          <span
            className={cn('mt-[7px] size-2 shrink-0 rounded-full', w.urgent ? 'bg-red' : 'bg-orange')}
            aria-hidden
          />
          <span className="min-w-0 flex-1 basis-[200px]">
            {/* Every row goes somewhere (v1.1 Phase 5): the module that
              * queued it named the screen, or the alert centre has it. */}
            <Link
              href={w.href ?? '/notifications'}
              className={cn(HIT, 'block text-body text-label hover:text-accent')}
            >
              {w.title}
            </Link>
            {w.sub && <span className="mt-0.5 block truncate text-subheadline text-secondary-label">{w.sub}</span>}
          </span>

          <span className="ml-auto flex shrink-0 gap-1.5">
            {asking === w.id ? (
              <>
                <ActionButton size="sm" onClick={() => act(w.id, () => snoozeAlert(w.id, 1))}>
                  1d
                </ActionButton>
                <ActionButton size="sm" onClick={() => act(w.id, () => snoozeAlert(w.id, 7))}>
                  7d
                </ActionButton>
              </>
            ) : (
              <>
                <ActionButton size="sm" onClick={() => setAsking(w.id)}>
                  Snooze
                </ActionButton>
                <ActionButton
                  size="sm"
                  variant="quiet"
                  aria-label={`Dismiss ${w.title}`}
                  onClick={() => act(w.id, () => readAlert(w.id))}
                >
                  Dismiss
                </ActionButton>
              </>
            )}
          </span>
        </div>
      ))}
      <More count={phoneLimit === undefined ? 0 : shown.length - phoneLimit} href="/notifications" />
    </div>
  )
}

export function ProposalList({
  proposals,
  phoneLimit,
}: {
  phoneLimit?: number
  proposals: { id: string; title: string; from: string }[]
}) {
  const [gone, setGone] = useState<string[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [, start] = useTransition()
  const toast = useToast()

  const act = (id: string, run: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setGone((g) => [...g, id])
    setEditing(null)
    start(async () => {
      const result = await run()
      if (!result.ok) {
        setGone((g) => g.filter((x) => x !== id))
        toast(result.error)
      }
    })
  }

  const shown = proposals.filter((p) => !gone.includes(p.id))

  if (shown.length === 0) {
    return <p className="px-1 py-2.5 text-footnote text-secondary-label">Nothing waiting for review.</p>
  }

  return (
    <div className="mt-2 flex flex-col">
      {shown.map((p, i) => (
        <div
          key={p.id}
          data-testid="proposal-row"
          className={cn(ROW, phoneLimit !== undefined && i >= phoneLimit && 'max-md:hidden')}
        >
          <span className="mt-[7px] size-2 shrink-0 rounded-full bg-accent" aria-hidden />
          <span className="min-w-0 flex-1 basis-[200px]">
            {editing === p.id ? (
              // Approving an edited title is what Edit is for: the proposal
              // is accepted, with your wording rather than the agent's.
              <input
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditing(null)
                  if (e.key === 'Enter' && draft.trim()) {
                    act(p.id, () => approveProposal(p.id, { title: draft.trim() }))
                  }
                }}
                aria-label={`Edit ${p.title}`}
                className="w-full rounded-control border border-accent bg-grouped-2 px-3 py-1.5 text-body text-label outline-none"
              />
            ) : (
              <span className="block text-body text-label">{p.title}</span>
            )}
            <span className="mt-0.5 block truncate text-subheadline text-secondary-label">
              Proposal from {p.from}, waiting for review
            </span>
          </span>

          <span className="ml-auto flex shrink-0 flex-wrap gap-1.5">
            <ActionButton
              size="sm"
              variant="brand"
              onClick={() =>
                act(p.id, () =>
                  approveProposal(
                    p.id,
                    // The edited wording is merged into the proposal's stored
                    // tool input. A tool with no title of its own rejects it
                    // and says so, rather than the edit being silently lost.
                    editing === p.id && draft.trim() ? { title: draft.trim() } : undefined,
                  ),
                )
              }
            >
              {editing === p.id ? 'Save and approve' : 'Approve'}
            </ActionButton>
            <ActionButton
              size="sm"
              onClick={() => {
                setEditing(editing === p.id ? null : p.id)
                setDraft(p.title)
              }}
            >
              {editing === p.id ? 'Cancel' : 'Edit'}
            </ActionButton>
            <ActionButton
              size="sm"
              variant="quiet"
              onClick={() => act(p.id, () => dismissProposal(p.id))}
            >
              Dismiss
            </ActionButton>
          </span>
        </div>
      ))}
      <More count={phoneLimit === undefined ? 0 : shown.length - phoneLimit} href="/review" />
    </div>
  )
}

/** The phone's way to the rows it does not show. Nothing from md up. */
function More({ count, href }: { count: number; href: string }) {
  if (count <= 0) return null
  return (
    <Link href={href} className="inline-flex min-h-11 items-center px-1 text-subheadline font-medium text-accent hover:underline md:hidden">
      and {count} more &rarr;
    </Link>
  )
}
