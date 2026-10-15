'use client'

import { useState } from 'react'
import { ActionButton } from './Button'

/**
 * Puts a value on the clipboard: the inbound URL and secret are typed into a
 * phone app, never by hand, and an error row is pasted into a fix. The label
 * names what is copied while the button says Copy; once it says Copied or
 * Failed the visible text is the name, so the change is announced.
 */
export function Copy({ value, label }: { value: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <ActionButton
      size="sm"
      variant={state === 'copied' ? 'brand' : 'outline'}
      aria-label={state === 'idle' ? label : undefined}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setState('copied')
        } catch {
          // Insecure origin, page not focused, or the browser refused.
          setState('failed')
        }
        setTimeout(() => setState('idle'), 1500)
      }}
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Failed' : 'Copy'}
    </ActionButton>
  )
}
