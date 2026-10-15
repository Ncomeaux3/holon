import { ActionButton, Card, CardHead } from '@/components/pos'
import { signOut } from './session-actions'

/**
 * The way out. The app had none: there was no sign out anywhere in it until
 * 2026-09-14, which on a single owner install is easy to miss and impossible
 * to work around, and it made the passkey path untestable because testing it
 * starts by being signed out.
 *
 * A plain form and a server action, so it works before hydration and on a
 * phone that is struggling.
 */
export function Session({ email }: { email: string }) {
  return (
    <Card className="max-w-[720px] space-y-3">
      <CardHead label="Session" meta="this browser" />

      <p className="text-footnote text-secondary-label">
        Signed in{email && <> as <span className="text-label">{email}</span></>}. Signing out ends
        the session in this browser only: the phone and the laptop are two sessions for the same
        owner, and one does not end the other.
      </p>

      <form action={signOut}>
        <ActionButton type="submit" variant="outline">
          Sign out
        </ActionButton>
      </form>
    </Card>
  )
}
