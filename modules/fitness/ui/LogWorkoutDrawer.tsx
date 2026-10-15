'use client'

import { useId, useState, useTransition } from 'react'
import { ActionButton, Eyebrow, Field, Overlay, submitOnModEnter, useFormErrors, useToast } from '@/components/pos'
import { fieldClass } from '@/components/pos/field'
import { isoDateIn, minutesIn } from '@/core/clock'
import { METRES_PER_MILE } from '../units'
import { logWorkout } from './actions'

const KINDS: [string, string][] = [
  ['strength', 'Strength'],
  ['run', 'Run'],
  ['ride', 'Ride'],
  ['swim', 'Swim'],
  ['walk', 'Walk'],
  ['other', 'Other'],
]

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Log workout: one done by hand, over `log_workout`. Sets are added after, in
 * the workout's drawer, so this stays the five facts every workout has.
 */
export function LogWorkoutDrawer({ timeZone, onClose }: { timeZone: string; onClose: () => void }) {
  const [initial] = useState(() => {
    const now = new Date()
    const m = minutesIn(now, timeZone)
    return {
      name: '',
      kind: 'strength',
      date: isoDateIn(now, timeZone),
      time: `${pad(Math.floor(m / 60))}:${pad(m % 60)}`,
      minutes: '',
      miles: '',
      notes: '',
    }
  })
  const [d, setD] = useState(initial)
  const set = (key: keyof typeof d) => (e: { target: { value: string } }) => setD((p) => ({ ...p, [key]: e.target.value }))
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => d[k] !== initial[k])
  const [pending, start] = useTransition()
  const toast = useToast()
  const formId = useId()
  const minutes = Number(d.minutes)
  const miles = d.miles.trim() === '' ? 0 : Number(d.miles)
  const { errors, ref: formRef, submit } = useFormErrors(() => ({
    name: d.name.trim() ? undefined : 'Name is required',
    date: d.date ? undefined : 'Date is required',
    time: d.time ? undefined : 'Start time is required',
    minutes: minutes > 0 && minutes <= 1440 ? undefined : 'Minutes must be a number from 1 to 1440',
    miles: Number.isFinite(miles) && miles >= 0 ? undefined : 'Miles must be a number',
  }))

  const save = () => {
    if (!submit()) return
    start(async () => {
      const result = await logWorkout({
        name: d.name.trim(),
        kind: d.kind,
        date: d.date,
        time: d.time,
        duration_s: Math.round(minutes * 60),
        distance_m: Math.round(miles * METRES_PER_MILE * 100) / 100,
        detail: d.notes.trim(),
      })
      if (!result.ok) toast(result.error)
      else {
        toast(`Logged. ${d.name.trim()}`)
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
          Fitness <span className="text-secondary-label">/</span> Log workout
        </>
      }
      footer={
        <>
          <ActionButton variant="outline" size="md" onClick={onClose}>
            Cancel
          </ActionButton>
          <ActionButton variant="solid" disabled={pending} type="submit" form={formId}>
            Log workout
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
        <Field label="Name" required error={errors.name}>
          <input aria-label="Workout name" value={d.name} onChange={set('name')} maxLength={200} className={fieldClass} />
        </Field>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Kind</Eyebrow>
          <select aria-label="Kind" value={d.kind} onChange={set('kind')} className={fieldClass}>
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" required error={errors.date}>
            <input type="date" aria-label="Date" value={d.date} onChange={set('date')} className={fieldClass} />
          </Field>
          <Field label="Start" required error={errors.time}>
            <input type="time" aria-label="Start" value={d.time} onChange={set('time')} className={fieldClass} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Minutes" required error={errors.minutes}>
            <input type="number" min={1} max={1440} inputMode="numeric" aria-label="Minutes" value={d.minutes} onChange={set('minutes')} className={fieldClass} />
          </Field>
          <Field label="Miles" error={errors.miles}>
            <input type="number" min={0} step="0.01" inputMode="decimal" aria-label="Miles" value={d.miles} onChange={set('miles')} className={fieldClass} />
          </Field>
        </div>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Notes</Eyebrow>
          <textarea aria-label="Notes" value={d.notes} onChange={set('notes')} onKeyDown={submitOnModEnter} rows={2} maxLength={500} className={fieldClass} />
        </label>
        <p className="text-caption-1 text-label">Sets go in after: open the workout from the list and add them there.</p>
      </form>
    </Overlay>
  )
}
