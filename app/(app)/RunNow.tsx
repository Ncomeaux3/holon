'use client'

import { useTransition } from 'react'
import { ActionButton, useToast } from '@/components/pos'
import { runNow } from './run-now'

export function RunNow() {
  const [pending, start] = useTransition()
  const toast = useToast()

  const run = () =>
    start(async () => {
      const result = await runNow()
      toast(
        result.failed > 0
          ? `Run ${result.status}, ${result.failed} job${result.failed === 1 ? '' : 's'} failed`
          : 'Run clean',
      )
    })

  // Solid, which is the design's treatment: this is the one thing on the
  // dashboard the owner presses, so it is the one filled control. On both
  // widths: pulling down refreshes the page, and a job should run from a
  // button that says so.
  return (
    <ActionButton variant="solid" size="xl" className="gap-2" disabled={pending} onClick={run}>
      {pending ? 'Running' : 'Run now'}
      {!pending && <span aria-hidden="true">&rarr;</span>}
    </ActionButton>
  )
}
