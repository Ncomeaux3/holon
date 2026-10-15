import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import { isPublicPath, ownerVerdict } from './core/owner'

/**
 * Refreshes the Supabase session cookie, then turns a stranger away before any
 * page renders.
 *
 * The redirect has to happen here rather than only in the (app) layout.
 * redirect() in a layout does not stop the page beneath it from rendering, and
 * Next serialises that render into the 307 response body, so a signed out
 * request was being handed the whole page payload: provider names, webhook
 * URLs, and the webhook shared secret. requireOwner() stays in the layout as
 * the backstop, the same way RLS backs up every query.
 */
export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request: { headers: request.headers } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return parseCookieHeader(request.cookies.toString())
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  const { data } = await supabase.auth.getClaims()
  const email = typeof data?.claims?.email === 'string' ? data.claims.email : null

  const verdict = ownerVerdict(email, process.env.OWNER_EMAIL ?? '')
  if (!verdict.ok && !isPublicPath(request.nextUrl.pathname)) {
    const redirect = NextResponse.redirect(new URL(verdict.redirectTo, request.url))
    // Carry the refreshed session cookies onto the redirect, or the very next
    // request arrives with the stale ones and bounces again.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie)
    return redirect
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|brand/|splash/|manifest.webmanifest).*)'],
}
