'use client'

import { Fragment, useState, useTransition, type ReactNode } from 'react'
import { ActionButton, Card, Eyebrow, useToast } from '@/components/pos'
import { fieldClass } from '@/components/pos/field'
import { cn } from '@/lib/utils'
import { approveProposal, dismissProposal, reopenProposal } from './actions'
import { confidenceClass, StateChip, type ReviewItem } from './ReviewList'

// Sticky panel rather than a drawer: the design keeps the list visible so you
// can work down the inbox without reopening anything.
export function ProposalPanel({ item }: { item: ReviewItem }) {
  const [editing, setEditing] = useState(false)
  // `edits` are kept after Enter; `drafts` are what the inputs hold now.
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  // The panel remounts per proposal (ReviewList keys it by id), so seeding
  // from the prop is safe: this is the same optimistic-then-revert shape
  // Inbox.tsx uses for a row, just for one item's status instead of an array.
  const [status, setStatus] = useState(item.status)
  const [busy, start] = useTransition()
  const toast = useToast()

  const canEdit = status === 'pending' && item.diff.some((d) => d.editable)
  const after = (field: string, fallback: string | null) => edits[field] ?? fallback

  function run(action: () => Promise<{ ok: boolean; error?: string }>, done: string, next: ReviewItem['status']) {
    setError(null)
    setStatus(next)
    start(async () => {
      const result = await action()
      if (result.ok) toast(done)
      else {
        setStatus(item.status)
        setError(result.error ?? 'Failed')
      }
    })
  }

  function toggleEdit() {
    if (!editing) {
      setDrafts(Object.fromEntries(item.diff.filter((d) => d.editable).map((d) => [d.field, after(d.field, d.after) ?? ''])))
    }
    setEditing(!editing)
  }

  function keep() {
    setEdits({ ...edits, ...drafts })
    setEditing(false)
  }

  function approve() {
    const patch = editing ? { ...edits, ...drafts } : edits
    run(
      () => approveProposal(item.id, Object.keys(patch).length ? patch : undefined),
      `Approved: ${item.title}`,
      'approved',
    )
  }

  const firstEditable = item.diff.find((d) => d.editable)?.field
  const show = (v: string | null) => (v === null || v === '' ? 'empty' : v)

  return (
    <Card className="flex flex-col gap-4 px-[22px] py-5 md:sticky md:top-7">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>
            {item.moduleLabel} <span className="text-secondary-label">/</span> {item.module}.{item.tool}
          </Eyebrow>
          <h2 className="mt-2.5 text-title-3 text-label">{item.title}</h2>
        </div>
        <StateChip status={status} />
      </div>

      <div>
        <Eyebrow>Why</Eyebrow>
        <p className="mt-2 text-footnote text-label">{item.reason}</p>
      </div>

      {item.diff.length > 0 && (
        <div>
          <Eyebrow>Proposed change</Eyebrow>
          <div className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-card bg-separator">
            {item.diff.map((d) => {
              const one = item.diff.length === 1
              const before = show(d.before)
              return (
                <Fragment key={d.field}>
                  <div className="min-w-0 bg-grouped-3 px-3 py-2.5">
                    <span className="text-caption-1 text-secondary-label">{one ? 'Current' : `${d.field} · current`}</span>
                    <div className={cn('num mt-1.5 break-words text-footnote', before === 'empty' ? 'text-secondary-label' : 'text-label')}>
                      {before}
                    </div>
                  </div>
                  <div className="min-w-0 bg-grouped-3 px-3 py-2.5">
                    <span className="text-caption-1 text-secondary-label">{one ? 'After' : `${d.field} · after`}</span>
                    {editing && d.editable ? (
                      <input
                        aria-label={`After · ${d.field}`}
                        autoFocus={d.field === firstEditable}
                        className={cn(fieldClass, 'num mt-1 px-2 py-1.5')}
                        value={drafts[d.field] ?? ''}
                        onChange={(e) => setDrafts({ ...drafts, [d.field]: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') keep()
                          if (e.key === 'Escape') setEditing(false)
                        }}
                      />
                    ) : (
                      <div className="num mt-1.5 break-words text-footnote text-accent">
                        {show(after(d.field, d.after))}
                      </div>
                    )}
                  </div>
                </Fragment>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-card bg-separator">
        <Cell label="Confidence">
          <div
            className={cn(
              'num mt-1.5 text-callout',
              item.confidence === null ? 'text-secondary-label' : confidenceClass(item.confidence),
            )}
          >
            {item.confidence === null ? 'not given' : `${Math.round(item.confidence * 100)}%`}
          </div>
        </Cell>
        <Cell label="Evidence">
          <div className={cn('mt-1.5 text-footnote', item.evidence ? 'text-label' : 'text-secondary-label')}>
            {item.evidence?.startsWith('https://mail.google.com/') ? (
              <a
                className="-my-3 inline-flex min-h-11 items-center text-accent hover:underline"
                href={item.evidence}
                target="_blank"
                rel="noreferrer"
              >
                Open in Gmail
              </a>
            ) : (
              (item.evidence ?? 'not given')
            )}
          </div>
        </Cell>
        <Cell label="Affects">
          <div className={cn('mt-1.5 text-footnote', item.affects ? 'text-label' : 'text-secondary-label')}>
            {item.affects ?? 'not given'}
          </div>
        </Cell>
      </div>

      {error && (
        <p className="rounded-control bg-red/15 px-3 py-2 text-footnote text-red-text">{error}</p>
      )}

      {status === 'pending' ? (
        <>
          <div className="flex flex-wrap gap-2 pt-1">
            <ActionButton variant="solid" size="xl" disabled={busy} onClick={approve}>
              {editing ? 'Save & approve' : 'Approve'} <span aria-hidden="true">&rarr;</span>
            </ActionButton>
            {canEdit && (
              <ActionButton
                className="h-auto min-h-11 self-stretch px-3.5 text-footnote text-label sm:h-auto"
                disabled={busy}
                onClick={toggleEdit}
              >
                {editing ? 'Cancel edit' : 'Edit'}
              </ActionButton>
            )}
            <ActionButton
              className="ml-auto h-auto min-h-11 self-stretch px-3.5 text-footnote text-secondary-label hover:text-red-text sm:h-auto"
              disabled={busy}
              onClick={() => run(() => dismissProposal(item.id), 'Dismissed', 'dismissed')}
            >
              Dismiss
            </ActionButton>
          </div>
          {item.guarded && (
            <p className="-mt-1.5 text-footnote text-orange-text">
              Guarded tool: approving writes to {item.moduleLabel} immediately.
            </p>
          )}
        </>
      ) : (
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-footnote text-secondary-label">
            {status === 'approved'
              ? `Approved. ${item.module}.${item.tool} ran.`
              : 'Dismissed. The agent will not re-propose this for 30 days. Undo puts it back in the inbox.'}
          </span>
          {/* Only a dismissal comes back: reopening an approved proposal would
            * run its tool a second time, and the write it made stays. */}
          {status === 'dismissed' && (
            <ActionButton
              className="text-label"
              disabled={busy}
              onClick={() => run(() => reopenProposal(item.id), 'Back in the inbox', 'pending')}
            >
              Undo
            </ActionButton>
          )}
        </div>
      )}
    </Card>
  )
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 bg-grouped-3 px-3 py-2.5">
      <Eyebrow>{label}</Eyebrow>
      {children}
    </div>
  )
}
