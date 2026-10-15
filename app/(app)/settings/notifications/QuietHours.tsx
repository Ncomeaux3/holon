'use client'

import { useTransition } from 'react'
import { ActionButton, timeFieldClass as timeField, useToast } from '@/components/pos'
import { useOptimisticAction } from '@/components/pos/useOptimisticAction'
import { setQuiet, type ActionResult } from './actions'

export function QuietHours({
  from,
  to,
  urgentOverride,
}: {
  from: string
  to: string
  urgentOverride: boolean
}) {
  const [pending, start] = useTransition()
  const toast = useToast()
  const [urgent, runUrgent] = useOptimisticAction<boolean, boolean, ActionResult>(
    urgentOverride,
    (_, next) => next,
  )

  const save = (key: 'quiet_from' | 'quiet_to', value: string) =>
    start(async () => {
      const result = await setQuiet(key, value)
      if (!result.ok) toast(result.error)
    })

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-3.5">
        <span className="text-footnote text-label">No push between</span>
        <input
          type="time"
          aria-label="Quiet hours start"
          defaultValue={from}
          disabled={pending}
          onBlur={(e) => save('quiet_from', e.target.value)}
          className={timeField}
        />
        <span className="text-footnote text-secondary-label">and</span>
        <input
          type="time"
          aria-label="Quiet hours end"
          defaultValue={to}
          disabled={pending}
          onBlur={(e) => save('quiet_to', e.target.value)}
          className={timeField}
        />
        <span className="text-footnote text-secondary-label">Reminders due in this window are delivered at {to}.</span>
      </div>

      <ActionButton
        variant={urgent ? 'brand' : 'outline'}
        onClick={() => runUrgent(!urgent, () => setQuiet('quiet_urgent_override', !urgent))}
      >
        {urgent ? 'Urgent breaks through' : 'Nothing breaks through'}
      </ActionButton>

      <p className="text-footnote text-secondary-label">
        Held, not dropped: a queued alert goes out on the next run after the window closes.
        {urgent
          ? ' A rule marked urgent is the exception, and there are four of them.'
          : ' Nothing is excepted right now, including a failed nightly job.'}
      </p>
    </div>
  )
}
