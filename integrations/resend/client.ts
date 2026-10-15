import { getCredentials } from '@/core/credentials'

/**
 * Whether this deployment is allowed to put mail in a real inbox.
 *
 * Production always is. Nothing else is unless it is asked for, because the
 * things that send are reachable from a test: the e2e suite presses Run now on
 * the dashboard, that is a real nightly run, and a real nightly run ends in a
 * real digest. On 2026-09-15 three local passes put six emails of fixture data
 * in the owner's inbox, reporting a Northwind Rewards card he does not own.
 *
 * EMAIL_SEND=1 is the deliberate local check, set for the one command that
 * wants it rather than left in .env, where it would undo this.
 */
export function sendingAllowed(): boolean {
  return process.env.VERCEL_ENV === 'production' || process.env.EMAIL_SEND === '1'
}

/**
 * The one thing that sends email. Everything queues into core.notifications
 * and leaves as a single plain text digest.
 *
 * An unverified Resend account can only send from onboarding@resend.dev and
 * only to its own signup address (verified 2026-09-05). That is exactly the
 * digest, so Phase 1 needs no domain. Set RESEND_FROM once you verify one.
 */
export const DEFAULT_FROM = 'Holon <onboarding@resend.dev>'

export async function sendEmail(args: {
  to: string
  subject: string
  text: string
}): Promise<{ id: string }> {
  // Checked here as well as in sendPending, because this is the function that
  // actually reaches Resend and it should be the thing that cannot.
  if (!sendingAllowed()) {
    throw new Error('Email sending is off outside production. Set EMAIL_SEND=1 to send from here.')
  }

  const key = (await getCredentials('resend'))?.api_key
  if (!key) throw new Error('Resend is not connected. Connect it on Settings > Connections.')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || DEFAULT_FROM,
      to: [args.to],
      subject: args.subject,
      text: args.text,
    }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  return (await res.json()) as { id: string }
}
