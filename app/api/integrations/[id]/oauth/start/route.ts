import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { requireOwner } from '@/core/auth'
import { getIntegration } from '@/core/integrations'
import { oauthStateCookie } from '@/core/oauth'
import { withLog } from '@/core/log'

// One redirect to the provider.
export const maxDuration = 30

/**
 * Where the Connect button points. Sets a one time state cookie, then hands off
 * to the provider. Generic: every oauth2 manifest uses this same route.
 */
async function handle(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireOwner()

  const { id } = await params
  const origin = new URL(request.url).origin

  const manifest = getIntegration(id)
  if (!manifest || manifest.auth.type !== 'oauth2') {
    return NextResponse.json({ error: 'Not an OAuth integration' }, { status: 404 })
  }

  // This is reached by clicking a button, so a missing client id goes back to
  // the page with something readable rather than a 500 of raw JSON.
  const clientId = process.env[`${id.toUpperCase()}_CLIENT_ID`]
  if (!clientId) {
    return NextResponse.redirect(
      `${origin}/settings/connections?error=${encodeURIComponent(
        `${id.toUpperCase()}_CLIENT_ID and _CLIENT_SECRET are not set in .env. Register an app with ${manifest.label} first.`,
      )}`,
    )
  }

  const state = randomBytes(32).toString('base64url')

  const authorize = new URL(manifest.auth.authorizeUrl)
  authorize.searchParams.set('client_id', clientId)
  authorize.searchParams.set('redirect_uri', `${origin}/api/integrations/${id}/oauth/callback`)
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('scope', manifest.auth.scopes.join(manifest.auth.scopeSeparator ?? ','))
  authorize.searchParams.set('state', state)
  for (const [key, value] of Object.entries(manifest.auth.params ?? {})) {
    authorize.searchParams.set(key, value)
  }

  const jar = await cookies()
  jar.set(oauthStateCookie(id), state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  })

  return NextResponse.redirect(authorize.toString())
}

// Rate limited and logged like every route under app/api. The limiter is the
// backstop behind the edge; the log is what survives Vercel's short retention.
export const GET = withLog(handle)
