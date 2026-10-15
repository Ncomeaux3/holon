'use server'

import { redirect } from 'next/navigation'
import { serverClient } from '@/core/db'
import { getOrigin } from '@/core/origin'
import { ownerVerdict } from '@/core/owner'
import { isCompleteCode, normalizeCode, verifyWithAnyType } from '@/core/otp'

// Server actions are standalone POST endpoints addressed by id, so neither the
// layout nor the proxy's owner check stands in front of them. Both actions here
// are reachable signed out by design: they are how a person signs in.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function back(params: Record<string, string>): never {
  redirect(`/login?${new URLSearchParams(params)}`)
}

/**
 * Sends the sign in email. It carries a six digit code and a link, because the
 * Supabase template holds both and they verify the same underlying token.
 */
export async function sendCode(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  if (!EMAIL.test(email)) {
    // Hand the typed value back so the field is not cleared on a typo.
    back({ error: 'invalid', email })
  }

  const verdict = ownerVerdict(email, process.env.OWNER_EMAIL ?? '')

  // Only the owner ever gets an email, and the reply is the same either way, so
  // the page never confirms which address owns this install. The design's
  // denied screen would answer exactly the question an attacker is asking.
  if (verdict.ok) {
    const supabase = await serverClient()
    await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${await getOrigin()}/auth/callback`,
        // No signup flow: one owner, created by pnpm setup.
        shouldCreateUser: false,
      },
    })
  }

  back({ sent: '1', email })
}

/**
 * Verifies the code and signs the owner in.
 *
 * This is the whole point of the code path. The session is created by the
 * browser that is reading this page, so it lands in that browser's cookie jar,
 * which is the one thing tapping a link out of a mail app cannot promise. On
 * iOS the home screen app has its own jar and a link opened in Mail signs
 * Safari in instead; typing the code here signs the app in.
 *
 * verifyOtp with an email and a token is not a PKCE exchange: Supabase returns
 * the session on the response and there is no code verifier cookie to match.
 */
export async function verifyCode(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  const code = normalizeCode(String(formData.get('code') ?? ''))

  if (!EMAIL.test(email)) back({ error: 'invalid', email })
  if (!isCompleteCode(code)) back({ sent: '1', email, error: 'code' })

  // Nobody but the owner has an account here, so a code checked against any
  // other address can only be someone finding out whether that address has
  // one. It gets the same reply as a wrong code, which is what it is.
  if (!ownerVerdict(email, process.env.OWNER_EMAIL ?? '').ok) {
    back({ sent: '1', email, error: 'code' })
  }

  const supabase = await serverClient()

  // One code, tried against each type GoTrue might have filed it under. See
  // VERIFY_TYPES: the documented 'email' alone refused every valid code on this
  // project, because a magic link to an existing user is stored as a recovery
  // token and the type has to match the column.
  const { ok } = await verifyWithAnyType(async (type) => {
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type })
    return error
  })

  // Wrong and expired are one message. Supabase does not reliably tell them
  // apart, and the next step is the same either way: ask for another.
  if (!ok) back({ sent: '1', email, error: 'code' })

  redirect('/')
}
