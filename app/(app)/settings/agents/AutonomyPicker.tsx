'use client'

import { PillGroup, useToast } from '@/components/pos'
import { useOptimisticAction } from '@/components/pos/useOptimisticAction'
import { AUTONOMY_LABELS, type Autonomy } from '@/core/autonomy'
import { setAutonomy, type ActionResult } from './actions'

const OPTIONS = (Object.keys(AUTONOMY_LABELS) as Autonomy[]).map((value) => ({
  value,
  label: AUTONOMY_LABELS[value],
}))

export function AutonomyPicker({ value }: { value: Autonomy }) {
  const toast = useToast()
  const [current, run] = useOptimisticAction<Autonomy, Autonomy, ActionResult>(
    value,
    (_, next) => next,
  )

  return (
    <PillGroup
      label="Agent autonomy"
      value={current}
      options={OPTIONS}
      onChange={(next) =>
        run(next, async () => {
          const result = await setAutonomy(next)
          if (result.ok) toast(`Autonomy: ${AUTONOMY_LABELS[next]}`)
          return result
        })
      }
    />
  )
}
