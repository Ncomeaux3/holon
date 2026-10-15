export type OwnerVerdict = { ok: true } | { ok: false; redirectTo: string }

/**
 * The whole access rule, kept pure so it can be tested without a session and
 * imported by the proxy without dragging next/headers into that runtime.
 *
 * There is exactly one owner and no signup flow, so anything that is not an
 * exact match for OWNER_EMAIL is a stranger.
 */
export function ownerVerdict(
  sessionEmail: string | null | undefined,
  ownerEmail: string,
): OwnerVerdict {
  const visitor = sessionEmail?.trim().toLowerCase() ?? ''
  const owner = ownerEmail.trim().toLowerCase()

  if (!visitor) return { ok: false, redirectTo: '/login' }
  // An unset OWNER_EMAIL locks everyone out rather than letting everyone in.
  if (!owner || visitor !== owner) return { ok: false, redirectTo: '/not-owner' }
  return { ok: true }
}

/**
 * Routes a stranger is allowed to reach. Everything under /api carries its own
 * check (CRON_SECRET, the MCP bearer token, a webhook's shared secret, the
 * OAuth state), so the proxy leaves those alone rather than breaking them.
 */
export function isPublicPath(pathname: string): boolean {
  if (pathname.startsWith('/api/')) return true
  // The legal pages: Google's consent screen links to them, and anyone must be
  // able to read them before signing in.
  return ['/login', '/auth/callback', '/not-owner', '/terms', '/privacy'].some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
}
