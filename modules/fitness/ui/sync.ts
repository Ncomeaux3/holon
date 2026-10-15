'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
import { syncModule } from '@/core/sync'

/** Pull from Strava now. The nightly job and this write the same row. */
export async function syncFitness(): Promise<{ ran: number; failed: string[] }> {
  await requireOwner()
  const result = await syncModule('fitness')
  revalidatePath('/fitness')
  revalidatePath('/', 'layout')
  return result
}
