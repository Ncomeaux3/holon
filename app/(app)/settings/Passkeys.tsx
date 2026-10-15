import { Card, CardHead, Row, RowList } from '@/components/pos'
import { serverClient } from '@/core/db'
import { AddPasskey } from './AddPasskey'
import { ForgetPasskey } from './ForgetPasskey'

// Supabase Auth owns the credentials, so there is no table here and nothing to
// migrate. This card is a view onto the owner's own account.

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })

export async function Passkeys() {
  const supabase = await serverClient()
  const { data, error } = await supabase.auth.passkey.list()

  // Passkeys are off in the project, or the API is gone. Say so rather than
  // showing an empty list under a button that can only fail. Supabase still
  // calls this API experimental, and the email code below it is not, so a
  // broken passkey API costs an explanation and never a way in.
  const off = Boolean(error)
  const passkeys = data ?? []

  return (
    <Card className="max-w-[720px] space-y-3">
      <CardHead label="Passkeys" meta={off ? 'unavailable' : `${passkeys.length} registered`} />

      {off ? (
        <p className="text-footnote text-secondary-label">
          Passkeys are not switched on for this Supabase project. Turn on Authentication &gt;
          Passkeys and set the relying party to the domain Holon is served from, then this becomes a
          button. Signing in with a code by email is unaffected either way.
        </p>
      ) : (
        <>
          {passkeys.length > 0 ? (
            <RowList>
              {passkeys.map((passkey) => (
                <Row
                  key={passkey.id}
                  title={passkey.friendly_name || 'Passkey'}
                  meta={
                    passkey.last_used_at
                      ? `made ${day(passkey.created_at)} · last used ${day(passkey.last_used_at)}`
                      : `made ${day(passkey.created_at)} · not used yet`
                  }
                  right={<ForgetPasskey id={passkey.id} />}
                />
              ))}
            </RowList>
          ) : (
            <p className="text-footnote text-secondary-label">
              No passkey registered, so every sign in is a six digit code by email.
            </p>
          )}

          <AddPasskey />
        </>
      )}

      <p className="text-footnote text-secondary-label">
        Each one is named after the browser that made it. A passkey kept in iCloud Keychain or a
        password manager follows the account, so it also signs in from the other devices that
        share it; the sign in page offers it in the email field. A passkey is bound to the domain
        it was created on. Moving Holon to another domain makes
        every passkey here unusable and each one has to be added again, so add them after the
        domain is settled. The email code is the way back in if a device is lost.
      </p>
    </Card>
  )
}
