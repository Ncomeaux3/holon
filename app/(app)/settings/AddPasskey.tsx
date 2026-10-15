'use client'

import { useRouter } from 'next/navigation'
import { useState, useSyncExternalStore } from 'react'
import { ActionButton, useToast } from '@/components/pos'
import { browserClient } from '@/core/db-browser'
import { deviceLabel } from '@/core/passkeys'

// The one part of passkeys a server cannot do: creating one is a WebAuthn
// ceremony, and only the browser can ask the device for a signature. Listing
// and removing are plain calls and stay on the server.

/** Nothing to subscribe to: the value only differs between server and client. */
const subscribeToNothing = () => () => {}

function messageFor(error: unknown): string | null {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
  const name = typeof error === 'object' && error && 'name' in error ? String(error.name) : ''

  // The owner dismissed the sheet, or it timed out. Not a failure to report.
  if (name === 'NotAllowedError' || name === 'AbortError') return null
  if (code === 'webauthn_credential_exists') return 'This device already has a passkey for Holon.'
  if (code === 'too_many_passkeys') return 'That is as many passkeys as this account can hold.'
  return error instanceof Error ? error.message : 'That did not work.'
}

export function AddPasskey() {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  // Whether this browser can do WebAuthn is not knowable on the server, so the
  // button renders after hydration and the first pass agrees on both sides.
  // Same pattern as the push Devices card.
  const mounted = useSyncExternalStore(subscribeToNothing, () => true, () => false)
  if (!mounted) return null

  if (!('PublicKeyCredential' in window)) {
    return (
      <p className="text-footnote text-secondary-label">
        This browser cannot do WebAuthn, so a passkey cannot be added from here. Add one from the
        phone or a laptop instead; a passkey in iCloud Keychain or a password manager follows the
        account rather than the device.
      </p>
    )
  }

  const add = async () => {
    setBusy(true)
    try {
      const client = browserClient()
      const { data, error } = await client.auth.registerPasskey()
      if (error) {
        const message = messageFor(error)
        if (message) toast(message)
        return
      }
      // Named after the browser that made it, because that is the only record
      // of where a passkey came from: Supabase lists a friendly_name and
      // nothing about the authenticator. A rename that fails leaves the
      // passkey usable under the plain name, so it is not an error.
      if (data?.id) {
        try {
          await client.auth.passkey.update({
            passkeyId: data.id,
            friendlyName: deviceLabel(navigator.userAgent),
          })
        } catch {
          // Still added, still usable, just unnamed.
        }
      }
      toast('Passkey added. This device can sign in with it now.')
      router.refresh()
    } catch (thrown) {
      const message = messageFor(thrown)
      if (message) toast(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ActionButton variant="brand" disabled={busy} onClick={() => void add()}>
      {busy ? 'Waiting for the device' : 'Add a passkey on this device'}
    </ActionButton>
  )
}
