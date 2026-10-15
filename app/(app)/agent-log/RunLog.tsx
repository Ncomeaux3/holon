'use client'

import { useState, useTransition } from 'react'
import {
  ActionButton,
  Chip,
  ConfirmButton,
  DiffList,
  EmptyState,
  Eyebrow,
  PillGroup,
  StatusChip,
  useToast,
} from '@/components/pos'
import type { Entry, Run } from '@/core/writelog-shape'
import { jobLabel } from './format'
import { cn } from '@/lib/utils'
import { redo, retryModule, undo, undoRun } from './actions'
import type { ActionResult } from './actions'

// The run accordion. One run open at a time, filtered by module, with every
// entry carrying the change it made and the button that puts it back.

export function RunLog({
  runs,
  moduleLabels,
  registeredModules,
}: {
  runs: Run[]
  /** Module id to display name, for the filter chips. */
  moduleLabels: Record<string, string>
  /** Nav order, and the only ids `runNightly({ module })` can rerun: a
   * failed job outside this list (a core stage, say) gets no Retry now,
   * since the button would otherwise rerun nothing and call it done. */
  registeredModules: string[]
}) {
  const [filter, setFilter] = useState('all')
  const [retrying, setRetrying] = useState<string | null>(null)
  // Open the newest run that actually wrote something. Defaulting to the newest
  // run means a page that greets you with "this run wrote nothing", which is
  // true and useless: the reason to come here is to see what changed.
  const [open, setOpen] = useState(
    (runs.find((r) => r.entries.length > 0) ?? runs[0])?.id ?? '',
  )
  const [, start] = useTransition()
  const toast = useToast()
  const [undoneOverride, setUndoneOverride] = useState<Record<string, boolean>>({})

  // Retry's own toast names the real outcome rather than a fixed word, the
  // same way Run now does, since a rerun can fail again.
  const retry = (module: string) =>
    start(async () => {
      setRetrying(module)
      const result = await retryModule(module)
      setRetrying(null)
      toast(
        result.ok
          ? result.failedJobs
            ? `Run partial, ${result.failedJobs} job${result.failedJobs === 1 ? '' : 's'} failed`
            : 'Run clean'
          : result.error,
      )
    })

  const matches = (e: Entry) => filter === 'all' || e.module === filter

  const shown = runs
    .map((r) => ({ ...r, entries: r.entries.filter(matches) }))
    // A run with nothing left after filtering drops out, except when nothing is
    // filtered: an empty run is itself worth seeing.
    .filter((r) => filter === 'all' || r.entries.length > 0)

  const total = shown.reduce((n, r) => n + r.entries.length, 0)
  const modules = [...new Set(runs.flatMap((r) => r.entries.map((e) => e.module)))].sort((a, b) => {
    const ai = registeredModules.indexOf(a)
    const bi = registeredModules.indexOf(b)
    // A module outside the registry (a core stage, say) sorts after every
    // real one rather than at an arbitrary spot indexOf's -1 would put it.
    return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi)
  })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <PillGroup
          label="Filter the log by module"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            ...modules.map((m) => ({ value: m, label: moduleLabels[m] ?? m })),
          ]}
        />
        <span className="text-footnote text-secondary-label">
          {total} {total === 1 ? 'entry' : 'entries'} / last {runs.length}{' '}
          {runs.length === 1 ? 'run' : 'runs'}
        </span>
      </div>

      {shown.length === 0 ? (
        <EmptyState headline="Nothing logged">
          No writes match this filter in the last {runs.length} runs. The agent only logs what it
          changed, so a quiet week is a short list.
        </EmptyState>
      ) : (
        <div className="space-y-2.5">
          {shown.map((r) => {
            const isOpen = open === r.id
            const reversible = r.entries.filter((e) => e.canUndo).map((e) => e.id)

            return (
              <div
                key={r.id}
                className={cn(
                  'overflow-hidden rounded-card bg-grouped-2',
                  isOpen && 'ring-2 ring-inset ring-accent',
                )}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpen(isOpen ? '' : r.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setOpen(isOpen ? '' : r.id)
                    }
                  }}
                  className="flex cursor-pointer flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card px-4 py-3.5 focus-visible:-outline-offset-6"
                >
                  <div className="min-w-0 flex-1 basis-[240px] space-y-1.5">
                    <div className="flex flex-wrap items-baseline gap-x-2.5">
                      <span className={cn('label num', r.status === 'clean' ? 'text-green-text' : 'text-orange-text')}>
                        {r.date}
                      </span>
                      <span className="text-footnote num text-secondary-label">
                        {r.clock} / {r.duration}
                      </span>
                    </div>
                    <p className="text-body text-label">{r.summary}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone="quiet">
                      {r.writes} {r.writes === 1 ? 'write' : 'writes'}
                    </Chip>
                    <StatusChip tone={r.status === 'clean' ? 'brand' : 'warn'}>
                      {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                    </StatusChip>
                    <span aria-hidden className="text-secondary-label">
                      {isOpen ? '▴' : '▾'}
                    </span>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-separator">
                    {reversible.length > 1 && (
                      <div className="flex justify-end px-4 pt-3">
                        <UndoRun ids={reversible} />
                      </div>
                    )}

                    {r.entries.length === 0 && (
                      <p className="text-footnote px-4 py-4 text-secondary-label">
                        This run wrote nothing. The jobs it ran are in the rail.
                      </p>
                    )}

                    {r.entries.map((e) => {
                      // Struck through the moment Undo or Redo is pressed,
                      // reverted with a toast on failure, same shape as
                      // Inbox.tsx's act() with a boolean instead of a list.
                      // Once overridden, canUndo/canRedo follow the optimistic
                      // undone value too, so the button swaps with the strike,
                      // rather than a stale Undo staying clickable a beat.
                      const overridden = e.id in undoneOverride
                      const undone = overridden ? undoneOverride[e.id] : e.undone
                      const canUndo = overridden ? !undone : e.canUndo
                      const canRedo = overridden ? undone : e.canRedo
                      const flip = (
                        action: () => Promise<ActionResult>,
                        next: boolean,
                        ok: string,
                      ) => {
                        setUndoneOverride((o) => ({ ...o, [e.id]: next }))
                        start(async () => {
                          const result = await action()
                          if (result.ok) toast(ok)
                          else {
                            setUndoneOverride((o) => ({ ...o, [e.id]: !next }))
                            toast(result.error)
                          }
                        })
                      }
                      return (
                        <div
                          key={e.id}
                          className="space-y-3 border-b border-separator px-4 py-3.5 last:border-b-0"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                            <div className="min-w-0 flex-1 basis-[220px] space-y-1">
                              <div className="flex flex-wrap items-baseline gap-x-2.5">
                                <span className={cn('label', undone ? 'text-secondary-label' : 'text-green-text')}>
                                  {e.moduleLabel}
                                </span>
                                <span className="text-footnote text-secondary-label">{e.kind}</span>
                                <span className="text-footnote num text-secondary-label">{e.time}</span>
                              </div>
                              {/* Struck through when reverted, so the log reads as
                                  a history rather than as current state. */}
                              <p
                                className={cn(
                                  'text-body',
                                  undone ? 'text-secondary-label line-through' : 'text-label',
                                )}
                              >
                                {e.title}
                              </p>
                              <p className="text-footnote text-secondary-label">{e.reason}</p>
                            </div>

                            <div className="flex shrink-0 items-center gap-2">
                              {canUndo && (
                                <ActionButton
                                  className="text-orange-text"
                                  onClick={() =>
                                    flip(
                                      () => undo(e.id),
                                      true,
                                      'Put back. The rule that made it is paused for seven days.',
                                    )
                                  }
                                >
                                  Undo
                                </ActionButton>
                              )}
                              {canRedo && (
                                <ActionButton onClick={() => flip(() => redo(e.id), false, 'Re-applied.')}>
                                  Redo
                                </ActionButton>
                              )}
                            </div>
                          </div>

                          <DiffList
                            undone={undone}
                            diffs={e.diff.map((d) => ({
                              field: d.field,
                              before: d.before === null ? null : String(d.before),
                              after: d.after === null ? null : String(d.after),
                            }))}
                          />
                        </div>
                      )
                    })}

                    {r.jobs
                      .filter((j) => j.status === 'failed')
                      .map((j) => (
                        <div
                          key={`${j.module}.${j.name}`}
                          className="space-y-2 border-t border-separator bg-red/5 px-4 py-3.5"
                        >
                          <Eyebrow className="text-red-text">Error</Eyebrow>
                          <p className="text-body text-label">{jobLabel(j.name)}</p>
                          {/* The raw provider message, not a paraphrase of it.
                              A rewritten error is one you cannot search for. */}
                          <p className="code text-footnote break-words text-label">
                            {j.detail ?? 'No detail recorded.'}
                          </p>
                          <p className="text-footnote text-secondary-label">
                            Retried twice inside the run, then left for the next one.
                          </p>
                          {/* Only when the module is a real one runNightly can
                              rerun: a job stamped with anything else would
                              have this button do nothing and call it done. */}
                          {registeredModules.includes(j.module) && (
                            <ActionButton disabled={retrying === j.module} onClick={() => retry(j.module)}>
                              {retrying === j.module ? 'Retrying' : 'Retry now'}
                            </ActionButton>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Every reversible write in one run, put back in one press. */
function UndoRun({ ids }: { ids: string[] }) {
  const [pending, start] = useTransition()
  const toast = useToast()

  // ConfirmButton takes no `disabled`, so a pending undo shows a disabled
  // stand-in rather than a button that could send the same ids twice.
  if (pending) return <ActionButton disabled>Undoing</ActionButton>

  // Undoing a whole run is worth asking about, through the Alert.
  return (
    <ConfirmButton
      confirmLabel="Undo this run"
      title={`Undo all ${ids.length} writes?`}
      message="Each one is put back, and the rules that made them are paused for seven days."
      onConfirm={() =>
        start(async () => {
          const result = await undoRun(ids)
          toast(result.ok ? `Put back ${result.undone} writes.` : result.error)
        })
      }
    >
      Undo this run
    </ConfirmButton>
  )
}
