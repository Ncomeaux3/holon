'use client'

import { ActionButton, useToast } from '@/components/pos'
import { useOptimisticAction } from '@/components/pos/useOptimisticAction'
import { updateSchedule, type ActionResult } from './actions'

/**
 * The master switch. Rules keep their own mute and snooze underneath it, so
 * resuming puts the set back exactly as it was rather than turning everything
 * on.
 */
export function PauseAll({ paused: initialPaused }: { paused: boolean }) {
  const toast = useToast()
  const [paused, run] = useOptimisticAction<boolean, boolean, ActionResult>(
    initialPaused,
    (_, next) => next,
  )

  return (
    <ActionButton
      variant="outline"
      // The artboard turns this orange while paused, not the accent `brand`
      // variant a selected control gets elsewhere.
      className={paused ? 'border-orange-text text-orange-text' : undefined}
      onClick={() =>
        run(!paused, async () => {
          const result = await updateSchedule('notifications_paused', !paused)
          if (result.ok) toast(paused ? 'Notifications resumed' : 'Everything paused. Rules keep their state.')
          return result
        })
      }
    >
      {paused ? 'Resume all' : 'Pause all'}
    </ActionButton>
  )
}
