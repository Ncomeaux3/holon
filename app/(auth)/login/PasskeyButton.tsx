'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ActionButton } from '@/components/pos'
import { browserClient } from '@/core/db-browser'

// Signing in with a passkey is three things a server cannot do: fetch a
// challenge, run the browser's credential ceremony, and hand the signed result
// back. So this is client code, and the session it creates is written into the
// cookies of the browser that ran the ceremony, which is the same reason the
// code path works where the link does not.

/** Nothing to subscribe to: the value only differs between server and client. */
const subscribeToNothing = () => () => {}

function messageFor(error: unknown): string | null {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  const name = typeof error === 'object' && error && 'name' in error ? String(error.name) : ''

  // The owner dismissed the sheet, or it timed out. Not a failure to report.
  if (name === 'NotAllowedError' || name === 'AbortError') return null

  if (code === 'passkey_disabled') {
    return 'Passkeys are not switched on for this install yet. Use the code.'
  }
  if (code === 'webauthn_credential_not_found') {
    return 'This device has no passkey for Holon. Sign in with the code, then add one in Settings.'
  }
  // What GoTrue answers when the browser signed with a credential the project
  // does not hold: one removed in Settings, or made against another project
  // or domain, and still in the keychain. Measured against the local stack
  // on 2026-09-20; the raw message was "Credential verification failed".
  if (code === 'webauthn_verification_failed') {
    return 'That passkey is not one Holon holds any more. Sign in with the code, then add it again in Settings.'
  }
  return error instanceof Error ? error.message : 'That did not work. Use the code.'
}

type Client = ReturnType<typeof browserClient>

/**
 * The same ceremony as the button, run without a press: the browser offers a
 * passkey it already holds as an autofill suggestion on the email field
 * (`autocomplete="username webauthn"` on the input), which is how a passkey
 * synced through iCloud Keychain or a password manager shows up on a device
 * that never enrolled one.
 *
 * supabase-js runs this ceremony only modally and keeps its serialisers
 * private, so this uses the two-step API with the WebAuthn Level 3 JSON
 * methods. A browser without those keeps the button and nothing else.
 *
 * Resolves to undefined on a session, the server's error when the owner picked
 * a passkey and verification refused it, or null when nothing happened: the
 * ceremony was aborted or failed in the browser, or the challenge could not be
 * fetched. Each load fetches one challenge; GoTrue expires it.
 */
async function conditionalSignIn(client: Client, signal: AbortSignal): Promise<unknown> {
  if (
    !('isConditionalMediationAvailable' in PublicKeyCredential) ||
    !('parseRequestOptionsFromJSON' in PublicKeyCredential)
  ) {
    return null
  }
  if (!(await PublicKeyCredential.isConditionalMediationAvailable())) return null

  const { data, error } = await client.auth.passkey.startAuthentication()
  if (error || !data || signal.aborted) return null

  let credential: Credential | null
  try {
    credential = await navigator.credentials.get({
      publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(
        data.options as PublicKeyCredentialRequestOptionsJSON,
      ),
      mediation: 'conditional',
      signal,
    })
  } catch {
    // Nobody pressed anything, so a browser that says it can do this and
    // then cannot (headless Chromium rejects with NotSupportedError) is not
    // an error to show. The button is still there.
    return null
  }
  if (!(credential instanceof PublicKeyCredential) || !('toJSON' in credential)) return null

  const { error: verifyError } = await client.auth.passkey.verifyAuthentication({
    challengeId: data.challenge_id,
    credential: credential.toJSON() as Parameters<
      Client['auth']['passkey']['verifyAuthentication']
    >[0]['credential'],
  })
  return verifyError ?? undefined
}

export function PasskeyButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The pending autofill ceremony. Only one WebAuthn request may be in flight,
  // so the button ends it before starting its own.
  const conditional = useRef<AbortController | null>(null)

  // Whether this browser can do WebAuthn is not knowable on the server, so the
  // button renders after hydration and the first pass agrees on both sides.
  // Same pattern as the push Devices card.
  const mounted = useSyncExternalStore(subscribeToNothing, () => true, () => false)
  const supported = mounted && typeof window !== 'undefined' && 'PublicKeyCredential' in window

  useEffect(() => {
    if (!supported) return
    const controller = new AbortController()
    conditional.current = controller
    void conditionalSignIn(browserClient(), controller.signal).then(
      (outcome) => {
        if (controller.signal.aborted) return
        if (outcome === undefined) {
          router.refresh()
          router.replace('/')
        } else if (outcome !== null) {
          setError(messageFor(outcome))
        }
      },
      // supabase-js rethrows anything that is not an AuthError (a network
      // failure, say). Unprompted, so not shown; the button is still there.
      () => {},
    )
    return () => controller.abort()
  }, [supported, router])

  if (!supported) return null

  const signIn = async () => {
    conditional.current?.abort()
    setBusy(true)
    setError(null)
    try {
      const { error } = await browserClient().auth.signInWithPasskey()
      if (error) {
        setError(messageFor(error))
        return
      }
      // refresh before replace: the session is a cookie the proxy reads on the
      // way in, and the router cache still holds the signed out /login it was
      // handed a moment ago. Refreshing drops that, then the navigation is a
      // real request carrying the new cookie.
      router.refresh()
      router.replace('/')
    } catch (thrown) {
      setError(messageFor(thrown))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <ActionButton
        type="button"
        size="lg"
        variant="accent"
        disabled={busy}
        onClick={signIn}
        className="w-full justify-center"
      >
        {busy ? 'Waiting for the passkey' : 'Sign in with a passkey'}
      </ActionButton>
      {error && (
        <p role="alert" className="label text-red-text">
          {error}
        </p>
      )}
    </div>
  )
}
