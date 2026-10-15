import { redirect } from 'next/navigation'
import { serverClient } from './db'
import { ownerVerdict } from './owner'

// The rule itself lives in core/owner.ts so the proxy can import it without
// dragging next/headers into that runtime. Re-exported here because this is
// where callers look for it.
export { ownerVerdict, isPublicPath, type OwnerVerdict } from './owner'

/**
 * Gate for every page under app/(app). Redirects and does not return unless
 * the owner is signed in.
 */
export async function requireOwner(): Promise<void> {
  const supabase = await serverClient()
  // getClaims, not getUser: the same call proxy.ts already makes on every
  // request. It verifies the JWT locally against the project's signing keys
  // instead of a network round trip to the auth server on every action.
  const { data } = await supabase.auth.getClaims()
  const email = typeof data?.claims?.email === 'string' ? data.claims.email : null

  const verdict = ownerVerdict(email, process.env.OWNER_EMAIL ?? '')
  if (!verdict.ok) redirect(verdict.redirectTo)
}
