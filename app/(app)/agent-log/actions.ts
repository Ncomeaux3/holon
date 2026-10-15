'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
import { runNightly } from '@/core/jobs'
import { redoWrite, undoWrite } from '@/core/writelog'

// Server actions are standalone POST endpoints addressed by id, so the (app)
// layout does not run for them and each one authenticates independently.

export type ActionResult = { ok: true } | { ok: false; error: string }

function failed(error: unknown): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : 'Failed' }
}

function done(): ActionResult {
  revalidatePath('/agent-log')
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function undo(id: string): Promise<ActionResult> {
  await requireOwner()
  try {
    await undoWrite(id)
    return done()
  } catch (error) {
    // Surfaced, not thrown: a tool that refuses the reverse write leaves the
    // entry as it was, and the owner needs to see why.
    return failed(error)
  }
}

export async function redo(id: string): Promise<ActionResult> {
  await requireOwner()
  try {
    await redoWrite(id)
    return done()
  } catch (error) {
    return failed(error)
  }
}

/**
 * Every reversible write in one run, put back together. One failure does not
 * stop the rest; what could not be reversed is named in the result.
 */
export async function undoRun(ids: string[]): Promise<ActionResult & { undone?: number }> {
  await requireOwner()

  let undone = 0
  const refused: string[] = []
  for (const id of ids) {
    try {
      await undoWrite(id)
      undone++
    } catch (error) {
      refused.push(error instanceof Error ? error.message : 'refused')
    }
  }

  done()
  if (undone === 0 && refused.length > 0) return { ok: false, error: refused[0] }
  return { ok: true, undone }
}

/**
 * Retry now, for one module's failed job. Runs every job that module
 * registers, immediately, in this request, not a queued rerun tonight: the
 * button on the screen calls it, and the owner pressing that is the
 * authorisation, the same reasoning `RunNow` uses on the dashboard.
 */
export async function retryModule(module: string): Promise<ActionResult & { failedJobs?: number }> {
  await requireOwner()
  try {
    const summary = await runNightly({ trigger: 'manual', module })
    done()
    return { ok: true, failedJobs: summary.jobs.filter((j) => j.status === 'failed').length }
  } catch (error) {
    return failed(error)
  }
}
