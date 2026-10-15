'use client'

import { useId, useState, useTransition } from 'react'
import { ActionButton, Eyebrow, Field, Overlay, useFormErrors, useToast } from '@/components/pos'
import { fieldClass } from '@/components/pos/field'
import { writeExercise } from './actions'
import type { FitnessData } from './Fitness'

export const MUSCLE_GROUPS = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core', 'Full body', 'Cardio']

export const MEASURES: Record<string, string> = {
  weight_reps: 'Weight and reps',
  reps: 'Reps only',
  time: 'Time',
  distance: 'Distance',
}

/** New exercise and Edit on a row: one form, the plan drawer's shape. */
export function ExerciseDrawer({
  exercise,
  onClose,
}: {
  exercise: FitnessData['exercises'][number] | null
  onClose: () => void
}) {
  const initial = {
    name: exercise?.name ?? '',
    muscleGroup: exercise?.muscleGroup ?? '',
    measure: exercise?.measure ?? 'weight_reps',
  }
  const [d, setD] = useState(initial)
  const dirty = d.name !== initial.name || d.muscleGroup !== initial.muscleGroup || d.measure !== initial.measure
  const [taken, setTaken] = useState<string | undefined>()
  const [pending, start] = useTransition()
  const toast = useToast()
  const formId = useId()
  const { errors, ref: formRef, submit } = useFormErrors(() => ({
    name: d.name.trim() ? undefined : 'Name is required',
  }))
  const groups = MUSCLE_GROUPS.includes(d.muscleGroup) || !d.muscleGroup ? MUSCLE_GROUPS : [...MUSCLE_GROUPS, d.muscleGroup]

  const save = () => {
    if (!submit()) return
    start(async () => {
      const result = await writeExercise({
        ...(exercise && { id: exercise.id }),
        name: d.name.trim(),
        muscle_group: d.muscleGroup,
        measure: d.measure,
      })
      if (!result.ok && result.fields?.name) setTaken(result.fields.name)
      else if (!result.ok) toast(result.error)
      else {
        toast(exercise ? 'Saved.' : `Added. ${d.name.trim()}`)
        onClose()
      }
    })
  }

  return (
    <Overlay
      open
      narrow
      onClose={onClose}
      dirty={dirty}
      eyebrow={
        <>
          Fitness <span className="text-secondary-label">/</span> {exercise ? 'Edit exercise' : 'New exercise'}
        </>
      }
      footer={
        <>
          <ActionButton variant="outline" size="md" onClick={onClose}>
            Cancel
          </ActionButton>
          <ActionButton variant="solid" disabled={pending} type="submit" form={formId}>
            Save exercise
          </ActionButton>
        </>
      }
    >
      <form
        id={formId}
        ref={formRef}
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Field label="Name" required error={errors.name ?? taken}>
          <input
            aria-label="Exercise name"
            value={d.name}
            onChange={(e) => {
              setTaken(undefined)
              setD({ ...d, name: e.target.value })
            }}
            maxLength={120}
            className={fieldClass}
          />
        </Field>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Muscle group</Eyebrow>
          <select
            aria-label="Muscle group"
            value={d.muscleGroup}
            onChange={(e) => setD({ ...d, muscleGroup: e.target.value })}
            className={fieldClass}
          >
            <option value="">None</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Measured by</Eyebrow>
          <select
            aria-label="Measured by"
            value={d.measure}
            onChange={(e) => setD({ ...d, measure: e.target.value })}
            className={fieldClass}
          >
            {Object.entries(MEASURES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-caption-1 text-label">
          A set holds reps and weight. Time and distance exercises are listed and planned, and their
          sessions are logged as workouts rather than sets.
        </p>
      </form>
    </Overlay>
  )
}
