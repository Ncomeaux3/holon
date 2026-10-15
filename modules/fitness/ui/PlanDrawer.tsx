'use client'

import { useId, useState, useTransition } from 'react'
import { ActionButton, Eyebrow, Field, Overlay, submitOnModEnter, useFormErrors, useToast } from '@/components/pos'
import { fieldClass } from '@/components/pos/field'
import { toGrams } from '../units'
import { readLastWeekBest, writePlan } from './actions'

// The plan form: name, cadence and notes above an editable exercise list.
// One component for create and edit, the same shape as insurance's
// PolicyForm, because a plan has no separate read-only view of its own; the
// Plan tab's card is that view.

const GRAMS_PER_POUND = 453.59237

let keyCounter = 0

type ItemRow = {
  /** React's key, and the write_plan position: the row order is the position sent. */
  key: string
  dayLabel: string
  exercise: string
  sets: string
  reps: string
  targetLb: string
  /** Not edited here; carried so an edit does not blank a note the coach wrote. */
  notes: string
}

function blankItem(): ItemRow {
  keyCounter += 1
  return { key: `new-${keyCounter}`, dayLabel: '', exercise: '', sets: '3', reps: '', targetLb: '', notes: '' }
}

type Plan = {
  id: string
  name: string
  goal: string
  daysPerWeek: number
  notes: string
  startedOn: string | null
  items: {
    id: string
    dayLabel: string
    exercise: string
    sets: number
    reps: string
    targetWeightG: number | null
    notes: string
  }[]
}

export function PlanDrawer({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const [name, setName] = useState(plan?.name ?? '')
  const [goal, setGoal] = useState(plan?.goal ?? '')
  const [daysPerWeek, setDaysPerWeek] = useState(String(plan?.daysPerWeek ?? 3))
  const [startedOn, setStartedOn] = useState(plan?.startedOn ?? '')
  const [notes, setNotes] = useState(plan?.notes ?? '')
  const [items, setItems] = useState<ItemRow[]>(() =>
    plan
      ? plan.items.map((it) => ({
          key: it.id,
          dayLabel: it.dayLabel,
          exercise: it.exercise,
          sets: String(it.sets),
          reps: it.reps,
          targetLb: it.targetWeightG === null ? '' : String(Math.round(it.targetWeightG / GRAMS_PER_POUND)),
          notes: it.notes,
        }))
      : [blankItem()],
  )
  const [initialItems] = useState(items)
  const [pending, start] = useTransition()
  const toast = useToast()

  const patch = (key: string, next: Partial<ItemRow>) =>
    setItems((rows) => rows.map((r) => (r.key === key ? { ...r, ...next } : r)))

  // "Copy from last week": a day's targets from the heaviest set logged per
  // exercise in the last seven days. Plan days are labels, not dates, so the
  // day is the label and last week is the log, whichever day it was lifted.
  const days = [...new Set(items.filter((r) => r.exercise.trim()).map((r) => r.dayLabel.trim()))]
  const copyLastWeek = (day: string) =>
    start(async () => {
      const best = new Map(Object.entries(await readLastWeekBest()).map(([name, b]) => [name.toLowerCase(), b]))
      let filled = 0
      const next = items.map((r) => {
        const b = r.dayLabel.trim() === day ? best.get(r.exercise.trim().toLowerCase()) : undefined
        if (!b) return r
        filled += 1
        return { ...r, reps: String(b.reps), targetLb: b.weightG > 0 ? String(Math.round(b.weightG / GRAMS_PER_POUND)) : r.targetLb }
      })
      setItems(next)
      toast(filled > 0 ? `Filled ${filled} from last week.` : 'Nothing logged last week for these exercises.')
    })

  const dirty =
    name !== (plan?.name ?? '') ||
    goal !== (plan?.goal ?? '') ||
    daysPerWeek !== String(plan?.daysPerWeek ?? 3) ||
    startedOn !== (plan?.startedOn ?? '') ||
    notes !== (plan?.notes ?? '') ||
    JSON.stringify(items) !== JSON.stringify(initialItems)
  const formId = useId()
  const { errors, ref: formRef, submit } = useFormErrors(() => ({
    name: name.trim() ? undefined : 'Name is required',
    exercises: items.some((r) => !r.exercise.trim()) ? 'Every exercise needs a name' : undefined,
  }))

  const save = () => {
    if (!submit()) return
    start(async () => {
      const result = await writePlan({
        ...(plan ? { id: plan.id } : {}),
        name: name.trim(),
        goal,
        days_per_week: Math.max(1, Math.min(7, Number(daysPerWeek) || 3)),
        notes,
        started_on: startedOn || null,
        items: items.map((r) => ({
          day_label: r.dayLabel.trim(),
          exercise: r.exercise.trim(),
          sets: Math.max(1, Math.min(20, Number(r.sets) || 3)),
          reps: r.reps.trim(),
          target_weight_g: r.targetLb.trim() === '' ? null : toGrams(Number(r.targetLb), 'lb'),
          notes: r.notes,
        })),
      })
      if (!result.ok) toast(result.error)
      else {
        toast('Saved.')
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
          Fitness <span className="text-secondary-label">/</span> {plan ? 'Edit plan' : 'New plan'}
        </>
      }
      footer={
        <>
          <ActionButton variant="outline" size="md" onClick={onClose}>
            Cancel
          </ActionButton>
          <ActionButton variant="solid" disabled={pending} type="submit" form={formId}>
            Save plan
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
          <input aria-label="Plan name" value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} />
        </Field>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Goal</Eyebrow>
          <input aria-label="Goal" value={goal} onChange={(e) => setGoal(e.target.value)} className={fieldClass} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <Eyebrow>Days a week</Eyebrow>
            <input
              type="number"
              min={1}
              max={7}
              aria-label="Days a week"
              value={daysPerWeek}
              onChange={(e) => setDaysPerWeek(e.target.value)}
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <Eyebrow>Started on</Eyebrow>
            <input
              type="date"
              aria-label="Started on"
              value={startedOn}
              onChange={(e) => setStartedOn(e.target.value)}
              className={fieldClass}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Notes</Eyebrow>
          <textarea
            aria-label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onKeyDown={submitOnModEnter}
            rows={3}
            className={fieldClass}
          />
        </label>

        <div>
          <Eyebrow>Exercises</Eyebrow>
          {/* gap-3: the sm buttons draw 32px inside a 44px target, so a wrap at
            * 402 overlaps neighbouring targets with any less. */}
          {days.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-3">
              {days.map((day) => (
                <ActionButton key={day} variant="outline" size="sm" disabled={pending} onClick={() => copyLastWeek(day)}>
                  Copy from last week{day ? `: ${day}` : ''}
                </ActionButton>
              ))}
            </div>
          )}
          {/* Two lines a row: the name line, then the three numbers with their
            * own captions. Six cells on one line clipped "AMRAP" at 1440 and
            * the exercise name itself in the 402 sheet. */}
          <div className="mt-1.5 flex flex-col gap-2.5">
            {items.map((row, i) => (
              <div key={row.key} className="flex flex-col gap-1.5 border-b border-separator pb-2.5 last:border-0">
                <div className="grid grid-cols-[96px_1fr_24px] gap-1.5">
                  <input
                    aria-label={`Day ${i + 1}`}
                    value={row.dayLabel}
                    onChange={(e) => patch(row.key, { dayLabel: e.target.value })}
                    placeholder="Upper"
                    maxLength={60}
                    className={fieldClass}
                  />
                  <input
                    aria-label={`Exercise ${i + 1}`}
                    value={row.exercise}
                    onChange={(e) => patch(row.key, { exercise: e.target.value })}
                    placeholder="Exercise"
                    maxLength={200}
                    className={fieldClass}
                  />
                  <ActionButton
                    variant="quiet"
                    size="sm"
                    aria-label={`Remove exercise ${i + 1}`}
                    onClick={() => setItems((rows) => rows.filter((r) => r.key !== row.key))}
                    className="self-center"
                  >
                    &#10005;
                  </ActionButton>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <label className="flex items-center gap-1.5 text-caption-1 text-secondary-label">
                    Sets
                    <input
                      type="number"
                      min={1}
                      max={20}
                      aria-label={`Sets ${i + 1}`}
                      value={row.sets}
                      onChange={(e) => patch(row.key, { sets: e.target.value })}
                      className={fieldClass}
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-caption-1 text-secondary-label">
                    Reps
                    <input
                      aria-label={`Reps ${i + 1}`}
                      value={row.reps}
                      onChange={(e) => patch(row.key, { reps: e.target.value })}
                      placeholder="8-12"
                      maxLength={40}
                      className={fieldClass}
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-caption-1 text-secondary-label">
                    Lb
                    <input
                      type="number"
                      aria-label={`Target lb ${i + 1}`}
                      value={row.targetLb}
                      onChange={(e) => patch(row.key, { targetLb: e.target.value })}
                      className={fieldClass}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
          {errors.exercises && (
            <span role="alert" className="text-footnote text-red-text">
              {errors.exercises}
            </span>
          )}
          <ActionButton
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => setItems((rows) => [...rows, blankItem()])}
          >
            + Add exercise
          </ActionButton>
        </div>

        <p className="text-caption-1 text-label">
          Saving a new plan archives the one in force. The coach proposes changes to it; only this
          form and an approved proposal write it.
        </p>
      </form>
    </Overlay>
  )
}
