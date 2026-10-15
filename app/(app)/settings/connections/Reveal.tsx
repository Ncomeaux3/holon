'use client'

import { useState } from 'react'
import { ActionButton, Copy } from '@/components/pos'

/** The webhook's shared secret: dots until asked for, so it is not on a screen left open. */
export function Reveal({ value }: { value: string }) {
  const [shown, setShown] = useState(false)
  return (
    <span className="flex items-center justify-between gap-2.5">
      <span className="num min-w-0 flex-1 break-all text-footnote text-label">
        {shown ? value : '••••••••••••••••'}
      </span>
      <ActionButton onClick={() => setShown((s) => !s)}>
        {shown ? 'Hide' : 'Reveal'}
      </ActionButton>
      <Copy value={value} />
    </span>
  )
}
