// What the Agent Log renders. No imports, deliberately: the screen is a client
// component, and anything here that reached core/db.ts would drag pg into the
// browser bundle. The queries live in core/writelog.ts.

/** One field, before and after. The same shape core.proposals.diff uses, so the
 *  Review panel and the Agent Log render a change with one component. */
export type Diff = { field: string; before: unknown; after: unknown }

export type RunStatus = 'running' | 'clean' | 'partial' | 'failed'

export type Job = {
  module: string
  name: string
  status: 'ok' | 'failed'
  durationMs: number
  detail?: string
}

export type Entry = {
  id: string
  module: string
  moduleLabel: string
  tool: string
  kind: string
  title: string
  reason: string
  diff: Diff[]
  time: string
  undone: boolean
  canUndo: boolean
  canRedo: boolean
}

export type Run = {
  id: string
  /** "7 SEP", the way the accordion heads it. */
  date: string
  clock: string
  duration: string
  status: RunStatus
  summary: string
  writes: number
  jobs: Job[]
  entries: Entry[]
}

/** "3m 41s", "48s". Runs are minutes and jobs are seconds, so one function. */
export function duration(ms: number | null): string {
  if (ms === null) return '--'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

/**
 * One sentence describing a run, built from what it actually did. The prototype
 * writes these by hand; here they have to come from the rows.
 */
export function summarise(entries: Entry[], jobs: Job[]): string {
  const failed = jobs.filter((j) => j.status === 'failed')

  if (entries.length === 0) {
    return failed.length > 0
      ? `No writes. ${failed.length} job${failed.length > 1 ? 's' : ''} failed.`
      : 'No writes. Nothing needed changing.'
  }

  const modules = [...new Set(entries.map((e) => e.moduleLabel))]
  const where =
    modules.length === 1
      ? modules[0]
      : `${modules.slice(0, -1).join(', ')} and ${modules[modules.length - 1]}`

  const head = `${entries.length} write${entries.length > 1 ? 's' : ''} across ${where}.`
  if (failed.length === 0) return head

  return `${head} ${failed.map((j) => j.name).join(' and ')} failed and ${
    failed.length > 1 ? 'were' : 'was'
  } skipped.`
}
