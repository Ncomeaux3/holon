'use client'

import { useState, useTransition } from 'react'
import { ActionButton, useToast } from '@/components/pos'
import { forgetPasskey } from './passkey-actions'

// Passkeys.tsx is a server component and hands this only the one id, not the
// whole list, so there is no row to remove from here (unlike Devices.tsx,
// which owns its full array). The button itself flips immediately instead;
// the row disappears a beat later once the real removal revalidates.
export function ForgetPasskey({ id }: { id: string }) {
  const [gone, setGone] = useState(false)
  const [, start] = useTransition()
  const toast = useToast()

  if (gone) return <span className="text-footnote text-secondary-label">Removed</span>

  return (
    <ActionButton
      onClick={() => {
        setGone(true)
        start(async () => {
          const result = await forgetPasskey(id)
          // The flip above is the guess; the toast is the server's word.
          if (result.ok) toast('Passkey removed.')
          else {
            setGone(false)
            toast(result.error)
          }
        })
      }}
    >
      Remove
    </ActionButton>
  )
}
