import { db } from './db'

// The Agent log's Errors tab (v1.2 Phase 2): the three places a failure is
// recorded, read as one list. Requests are core.request_log rows at 400 or
// above, jobs are the failed entries inside partial and failed core.job_runs,
// and client rows are what error.tsx posted. No new table for requests or
// jobs; this only reads what withLog and runJob already write.

export const RANGES = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' } as const
export type Range = keyof typeof RANGES

export type ErrorRow = {
  id: string
  at: Date
  /** A registered module id, or 'system' for core, api and settings routes. */
  module: string
  /** "POST /api/mcp 500", "finance / sync_simplefin", "/finance". */
  where: string
  text: string
  digest?: string | null
  stack?: string | null
}

/** The module a route belongs to: its first path segment when a module owns it. */
export function moduleOf(route: string, known: readonly string[]): string {
  const first = route.split(/[/?#]/).filter(Boolean)[0]
  return first && known.includes(first) ? first : 'system'
}

type RunRow = { id: string; started_at: Date; log: unknown }
type LoggedJob = { module: string; name: string; status: string; detail?: string }

/** One row per failed job in a run's log. */
export function failedJobsOf(run: RunRow): ErrorRow[] {
  const jobs = (run.log as { jobs?: LoggedJob[] } | null)?.jobs
  if (!Array.isArray(jobs)) return []
  return jobs
    .filter((j) => j.status === 'failed')
    .map((j) => ({
      id: `${run.id}:${j.module}.${j.name}`,
      at: run.started_at,
      module: !j.module || j.module === 'core' ? 'system' : j.module,
      where: `${j.module ?? 'core'} / ${j.name}`,
      text: j.detail ?? 'failed, no detail recorded',
    }))
}

/** What the Copy button puts on the clipboard: plain text, one line. */
export function copyText(row: { where: string; when: string; text: string }): string {
  return `${row.where} · ${row.when} · ${row.text}`
}

export async function listErrors({
  range,
  known,
  module,
}: {
  range: Range
  /** Registered module ids, for moduleOf. */
  known: readonly string[]
  module?: string
}): Promise<{ requests: ErrorRow[]; jobs: ErrorRow[]; client: ErrorRow[]; modules: string[] }> {
  const interval = RANGES[range]
  const [requests, runs, client] = await Promise.all([
    db().query<{ id: string; occurred_at: Date; route: string; method: string; status: number; error: string | null }>(
      `select id, occurred_at, route, method, status, error
         from core.request_log
        where status >= 400 and occurred_at >= now() - $1::interval
        order by occurred_at desc
        limit 200`,
      [interval],
    ),
    db().query<RunRow>(
      `select id, started_at, log
         from core.job_runs
        where status in ('partial', 'failed') and started_at >= now() - $1::interval
        order by started_at desc
        limit 60`,
      [interval],
    ),
    db().query<{ id: string; occurred_at: Date; route: string; digest: string | null; message: string; stack: string | null }>(
      `select id, occurred_at, route, digest, message, stack
         from core.client_errors
        where occurred_at >= now() - $1::interval
        order by occurred_at desc
        limit 200`,
      [interval],
    ),
  ])

  const all = {
    requests: requests.rows.map((r) => ({
      id: r.id,
      at: r.occurred_at,
      module: moduleOf(r.route, known),
      where: `${r.method} ${r.route} ${r.status}`,
      text: r.error ?? `status ${r.status}`,
    })),
    jobs: runs.rows.flatMap(failedJobsOf),
    client: client.rows.map((r) => ({
      id: r.id,
      at: r.occurred_at,
      module: moduleOf(r.route, known),
      where: r.route,
      text: r.message,
      digest: r.digest,
      stack: r.stack,
    })),
  }

  const modules = [...new Set([...all.requests, ...all.jobs, ...all.client].map((r) => r.module))].sort()
  const keep = (r: ErrorRow) => !module || r.module === module
  return {
    requests: all.requests.filter(keep),
    jobs: all.jobs.filter(keep),
    client: all.client.filter(keep),
    modules,
  }
}
