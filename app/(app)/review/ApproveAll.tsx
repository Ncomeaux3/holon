'use client'

import { useTransition } from 'react'
import { ActionButton, useToast } from '@/components/pos'
import { approveAllUnguarded } from './actions'

/**
 * Clears the proposals no module marked guarded. Money, policy and goal writes
 * are never in this set, so the button empties the noise and leaves the
 * decisions.
 */
export function ApproveAll({ count, short }: { count: number; short?: boolean }) {
  const [pending, start] = useTransition()
  const toast = useToast()

  return (
    <ActionButton
      size={short ? 'pill' : 'md'}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await approveAllUnguarded()
          toast(
            result.ok
              ? `Approved ${result.approved ?? 0} of ${count}`
              : 'Nothing approved, see the inbox',
          )
        })
      }
    >
      {pending ? 'Approving' : short ? `Approve all (${count})` : `Approve all non-guarded (${count})`}
    </ActionButton>
  )
}
