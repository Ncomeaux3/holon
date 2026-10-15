import { NextResponse } from 'next/server'
import { serverClient } from '@/core/db'

/**
 * Where the link in the sign in email lands. Exchanges the one time code for a
 * session cookie, then hands off to the app, which gates on requireOwner().
 *
 * This only works in the browser that asked for the email: signInWithOtp runs
 * server side and PKCE puts the code verifier in that browser's cookies. A link
 * tapped in a mail app opens a webview or Safari instead, neither of which has
 * it, and the exchange fails on a link that is perfectly valid. That is what
 * the six digit code on /login is for, and it is where both failures below
 * send the owner.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const supabase = await serverClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=expired`)
  }

  return NextResponse.redirect(origin)
}
