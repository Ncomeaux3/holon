'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
import { runNightly } from '@/core/jobs'

/**
 * The Run now button. A server action rather than a call to /api/cron/nightly,
 * so it needs no CRON_SECRET: it is already behind requireOwner(), and the
 * owner pressing a button in their own app is the authorisation.
 */
export async function runNow(): Promise<{ status: string; failed: number }> {
  await requireOwner()

  const summary = await runNightly({ trigger: 'manual' })
  revalidatePath('/', 'layout')

  return { status: summary.status, failed: summary.jobs.filter((j) => j.status === 'failed').length }
}
