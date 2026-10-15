'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
import { serverClient } from '@/core/db'

// Server actions are standalone POST endpoints addressed by id. The (app)
// layout does not run for them, so each one authenticates independently.

export type PasskeyResult = { ok: true } | { ok: false; error: string }

/**
 * Removes one passkey. Supabase Auth owns the credential, so there is nothing
 * in this database to delete alongside it.
 */
export async function forgetPasskey(passkeyId: string): Promise<PasskeyResult> {
  await requireOwner()

  const supabase = await serverClient()
  const { error } = await supabase.auth.passkey.delete({ passkeyId })
  if (error) return { ok: false, error: error.message }

  revalidatePath('/settings')
  return { ok: true }
}
