import { db } from './db'
import { runJob } from './jobs'
import { getIntegration } from './integrations'
import { getModule, missingConnections } from './modules'

// What a module's header band says about syncing, and the button that does it.
//
// The provider name, when it last pulled, and whether it went well are all
// facts core already holds: `requires` names the integration, `core.jobs` holds
// the run. Nothing here knows what a bank or a training log is.

/**
 * A module's sync jobs, by convention: anything named `sync_*` or `pull_*`.
 *
 * The convention is the whole contract. A module that names its import job
 * something else has no sync band, which is a missing button rather than a
 * broken screen.
 */
function syncJobs(moduleId: string) {
  return (getModule(moduleId)?.jobs ?? []).filter((j) => /^(sync|pull)_/.test(j.name))
}

export type SyncState = {
  /** "SimpleFIN Bridge", or the integration id when it has no label. */
  provider: string | null
  at: string | null
  status: string | null
  /** False when the module has no importing job at all. */
  syncable: boolean
  /** False when the provider it imports from has no credentials yet. */
  connected: boolean
}

export async function syncState(moduleId: string): Promise<SyncState> {
  const jobs = syncJobs(moduleId)
  const provider = (getModule(moduleId)?.requires ?? [])[0] ?? null

  if (jobs.length === 0) {
    return { provider: null, at: null, status: null, syncable: false, connected: false }
  }

  const { rows } = await db().query<{ last_run: Date | null; last_status: string | null }>(
    `select last_run, last_status from core.jobs
      where module = $1 and name = any($2)
      order by last_run desc nulls last
      limit 1`,
    [moduleId, jobs.map((j) => j.name)],
  )

  // A job row can outlive the credentials that made it: a demo seed, or a
  // connection removed since. Saying "synced 7h ago" beside a banner saying the
  // provider is not connected is the kind of contradiction a dashboard should
  // never show, so the band asks.
  const missing = provider ? await missingConnections([provider]) : []

  return {
    provider: provider ? (getIntegration(provider)?.label ?? provider) : null,
    at: rows[0]?.last_run ? new Date(rows[0].last_run).toISOString() : null,
    status: rows[0]?.last_status ?? null,
    syncable: true,
    connected: missing.length === 0,
  }
}

/**
 * Run this module's importing jobs now.
 *
 * Through runJob, so a manual pull is recorded exactly as the nightly one is:
 * the band that shows when it last ran is reading the row this writes.
 */
export async function syncModule(moduleId: string): Promise<{ ran: number; failed: string[] }> {
  const jobs = syncJobs(moduleId)
  const failed: string[] = []

  for (const job of jobs) {
    const result = await runJob(moduleId, job.name, job.run)
    if (result.status === 'failed') failed.push(job.name)
  }

  return { ran: jobs.length, failed }
}
