'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
import { runJob } from '@/core/jobs'
import { syncModule } from '@/core/sync'
import { lastPullDetail } from '../data'
import { PULL_DAYS, syncSimpleFin } from '../jobs/sync-simplefin'

/** Pull from the bank now. The nightly job and this write the same row. */
export async function syncFinance(): Promise<{ ran: number; failed: string[] }> {
  await requireOwner()
  const result = await syncModule('finance')
  revalidatePath('/finance')
  revalidatePath('/', 'layout')
  return result
}

/**
 * Re-ask for the first-run window. Through runJob under the nightly job's own
 * name, so the band's clock and the Agent log read the row this writes.
 */
export async function pullFinance(): Promise<{ ran: number; failed: string[]; detail?: string }> {
  await requireOwner()
  const result = await runJob('finance', 'sync_simplefin', () => syncSimpleFin({ days: PULL_DAYS }))
  revalidatePath('/finance')
  revalidatePath('/', 'layout')
  return {
    ran: 1,
    failed: result.status === 'failed' ? ['sync_simplefin'] : [],
    // The per-account counts, from the log row the job just wrote.
    detail: result.status === 'ok' ? ((await lastPullDetail()) ?? undefined) : result.detail,
  }
}
