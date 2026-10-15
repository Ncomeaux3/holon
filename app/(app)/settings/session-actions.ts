'use server'

import { redirect } from 'next/navigation'
import { requireOwner } from '@/core/auth'
import { serverClient } from '@/core/db'

// Server actions are standalone POST endpoints addressed by id. The (app)
// layout does not run for them, so this authenticates independently.

/**
 * Ends the session in this browser.
 *
 * Scope local, not global: a phone and a laptop are two sessions for the same
 * one owner, and signing out of the phone should not knock the laptop out
 * mid-edit. Losing a device is the case global scope is for, and that is a
 * different button than this one.
 */
export async function signOut() {
  await requireOwner()

  const supabase = await serverClient()
  await supabase.auth.signOut({ scope: 'local' })

  redirect('/login')
}
