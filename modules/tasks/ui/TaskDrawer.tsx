'use client'

import Link from 'next/link'
import { useId, useState } from 'react'
import {
  ActionButton,
  Eyebrow,
  Field,
  Overlay,
  SkillPicker,
  fieldClass,
  submitOnModEnter,
  useFormErrors,
} from '@/components/pos'
import { parseNumber } from '@/core/numbers'
import { cn } from '@/lib/utils'
import { nextAfter, repeatLabel, sameRule, type Repeat } from '../repeat'
import type { Task } from '../shape'
import { writeTask, type ActionResult, type WriteInput } from './actions'

// The task drawer, as the artboard draws it: a 480px form that holds its edits
// until Save, with Delete in the footer for an existing task. The same form
// with Create at the bottom is New task.

const field = fieldClass

/** The artboard's due options. `date` reveals a native date input beside the select. */
const DUE_DAYS: Record<string, number | null> = {
  today: 0,
  tomorrow: 1,
  week: 4,
  later: 14,
  none: null,
}

const REMIND = [
  { value: '', label: 'No reminder' },
  { value: '0', label: 'At the time' },
  { value: '30', label: '30 min before' },
  { value: '1440', label: 'Day before' },
]

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Fri 23 Oct", with the year when it is not `thisYear`'s. */
function dayLabel(iso: string, thisYear: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const year = iso.slice(0, 4) === thisYear ? '' : ` ${iso.slice(0, 4)}`
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}${year}`
}

/**
 * The drawer's repeat options, worded from the due date: weekly on its
 * weekday, monthly on its day. `custom` is a rule written through the tool
 * (two weekdays, an interval) that none of these describes; it is kept as is.
 */
type RepeatKey = '' | 'day' | 'week' | 'month' | 'last' | 'year' | 'custom'

function ruleFor(key: RepeatKey, due: string, custom: Repeat | null): Repeat | null {
  const d = new Date(`${due}T00:00:00Z`)
  if (key === 'day') return { every: 'day' }
  if (key === 'week') return { every: 'week', on: [d.getUTCDay()] }
  if (key === 'month') return { every: 'month', on: [d.getUTCDate()] }
  if (key === 'last') return { every: 'month', on: [-1] }
  if (key === 'year') return { every: 'year' }
  if (key === 'custom') return custom
  return null
}

function keyFor(repeat: Repeat | null, due: string): RepeatKey {
  if (!repeat) return ''
  const keys: RepeatKey[] = ['day', 'week', 'month', 'last', 'year']
  const same = keys.find((k) => sameRule(ruleFor(k, due, null)!, repeat))
  return same ?? 'custom'
}

function isoFrom(today: Date, days: number): string {
  const d = new Date(today)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysFrom(today: Date, iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86_400_000)
}

export function TaskDrawer({
  task,
  projects,
  goals,
  skills,
  today,
  reminderChannels,
  onClose,
  onSave,
  onDelete,
  prefill,
}: {
  /** Null is New task. */
  task: Task | null
  projects: { id: string; name: string; goalRef: string | null }[]
  goals: { id: string; title: string }[]
  skills: [string, string][]
  today: Date
  reminderChannels: string[] | null
  onClose: () => void
  onSave: (action: () => Promise<ActionResult>, ok?: string) => void
  onDelete?: () => void
  /** What the view that opened New task already implies: a due date, goal or project. */
  prefill?: Partial<WriteInput>
}) {
  // The date as a select value: a named option when it is one, else `date`
  // with the day itself in the input beside it. A new task is due today unless
  // the column it was added from says otherwise.
  const dueInDays = task
    ? task.dueInDays
    : prefill?.due_on === undefined
      ? 0
      : prefill.due_on === null
        ? null
        : daysFrom(today, prefill.due_on)
  const dateKey =
    dueInDays === null ? 'none' : dueInDays === 0 ? 'today' : dueInDays === 1 ? 'tomorrow' : 'date'

  const initial = {
    title: task?.title ?? '',
    due: dateKey,
    dueDate: dueInDays === null ? '' : isoFrom(today, dueInDays),
    priority: task?.priority ?? 'P2',
    project: task?.projectName ?? prefill?.project ?? '',
    time: task?.dueAt ?? '',
    remind: task?.remindMinutes === null || !task ? '' : String(task.remindMinutes),
    estimate: task?.estimateMinutes === null || !task ? '' : String(task.estimateMinutes),
    // The task's own goal. What it inherits from the project is a caption, not
    // a value, so saving never copies the project's goal onto the task.
    goal: task?.ownGoalRef ?? prefill?.goal_ref ?? '',
    notes: task?.notes ?? '',
    repeat: keyFor(task?.repeat ?? null, dueInDays === null ? isoFrom(today, 0) : isoFrom(today, dueInDays)),
  }
  const [draft, setDraft] = useState(initial)
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => draft[k] !== initial[k])
  const formId = useId()
  const { errors, ref: formRef, submit } = useFormErrors(() => ({
    title: draft.title.trim() ? undefined : 'Title is required',
    estimate:
      draft.estimate.trim() && parseNumber(draft.estimate) === null ? 'Estimate must be a number' : undefined,
  }))
  const inherited = draft.goal
    ? null
    : goals.find((g) => g.id === projects.find((p) => p.name === draft.project)?.goalRef)
  const set = (key: keyof typeof draft) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }))

  const dueOn =
    draft.due === 'date'
      ? draft.dueDate || null
      : DUE_DAYS[draft.due] === null
        ? null
        : isoFrom(today, DUE_DAYS[draft.due]!)
  // A repeat with no due date counts from today, as the complete tool does.
  const todayIso = isoFrom(today, 0)
  const rule = ruleFor(draft.repeat as RepeatKey, dueOn ?? todayIso, task?.repeat ?? null)

  const save = () => {
    if (!submit()) return
    const title = draft.title.trim()
    const input: WriteInput = {
      ...(task && { id: task.id }),
      title,
      notes: draft.notes,
      due_on: dueOn,
      repeat: rule,
      due_at: draft.time || null,
      priority: draft.priority,
      project: draft.project || null,
      goal_ref: draft.goal || null,
      estimated_minutes: parseNumber(draft.estimate),
      remind_minutes: draft.remind === '' ? null : Number(draft.remind),
    }
    onSave(() => writeTask(input), task ? 'Saved' : `Added. ${title}`)
    onClose()
  }

  return (
    <Overlay
      open
      narrow
      onClose={onClose}
      dirty={dirty}
      eyebrow={
        <>
          Tasks <span className="text-secondary-label">/</span> {task ? 'Edit' : 'New task'}
        </>
      }
      title={task ? task.title : 'New task'}
      footer={
        <>
          {task && (
            <ActionButton variant="danger" size="md" onClick={onDelete} className="mr-auto">
              Delete
            </ActionButton>
          )}
          <ActionButton variant="quiet" size="md" onClick={onClose}>
            Cancel
          </ActionButton>
          <ActionButton variant="accent" size="md" type="submit" form={formId}>
            {task ? 'Save' : 'Create'}
          </ActionButton>
        </>
      }
    >
      <form
        id={formId}
        ref={formRef}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Field label="Title" required error={errors.title}>
          <input
            value={draft.title}
            onChange={set('title')}
            placeholder="What needs doing?"
            className={cn(field, 'text-body')}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <div className={cn('flex flex-col gap-1.5', draft.due === 'date' && 'col-span-2')}>
            <Eyebrow>Due</Eyebrow>
            <div className="flex items-center gap-2">
              <select aria-label="Due" value={draft.due} onChange={set('due')} className={field}>
                <option value="today">Today</option>
                <option value="tomorrow">Tomorrow</option>
                <option value="week">This week</option>
                <option value="later">Later</option>
                <option value="date">Pick a date</option>
                <option value="none">No date</option>
              </select>
              {draft.due === 'date' && (
                <input
                  type="date"
                  aria-label="Due date"
                  value={draft.dueDate}
                  onChange={set('dueDate')}
                  className={cn(field, 'num')}
                />
              )}
            </div>
          </div>
          <label className="flex flex-col gap-1.5">
            <Eyebrow>Priority</Eyebrow>
            <select value={draft.priority} onChange={set('priority')} className={cn(field, 'num')}>
              <option>P1</option>
              <option>P2</option>
              <option>P3</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <Eyebrow>Project</Eyebrow>
            <select value={draft.project} onChange={set('project')} className={field}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <Eyebrow>Time · optional</Eyebrow>
            <div className="flex items-center gap-2">
              <input type="time" value={draft.time} onChange={set('time')} className={cn(field, 'num')} />
              {draft.time && (
                <ActionButton
                  variant="quiet"
                  size="sm"
                  onClick={() => setDraft((d) => ({ ...d, time: '' }))}
                >
                  Clear
                </ActionButton>
              )}
            </div>
          </label>
          <label className="flex flex-col gap-1.5">
            <Eyebrow>Remind me</Eyebrow>
            <select value={draft.remind} onChange={set('remind')} className={field}>
              {REMIND.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <Field label="Estimate · min" error={errors.estimate}>
            <input
              inputMode="decimal"
              value={draft.estimate}
              onChange={set('estimate')}
              className={cn(field, 'num')}
            />
          </Field>
        </div>

        <label className="flex flex-col gap-1.5">
          <Eyebrow>Repeat</Eyebrow>
          <select aria-label="Repeat" value={draft.repeat} onChange={set('repeat')} className={field}>
            <option value="">Does not repeat</option>
            {(['day', 'week', 'month', 'last', 'year'] as const).map((k) => {
              const r = ruleFor(k, dueOn ?? todayIso, null)!
              return (
                <option key={k} value={k}>
                  {k === 'year' ? `Yearly on ${dayLabel(dueOn ?? todayIso, (dueOn ?? todayIso).slice(0, 4)).slice(4)}` : repeatLabel(r)}
                </option>
              )
            })}
            {task?.repeat && draft.repeat === 'custom' && (
              <option value="custom">{repeatLabel(task.repeat)}</option>
            )}
          </select>
          {rule && (
            <span className="num text-subheadline text-secondary-label">
              Next: {dayLabel(nextAfter(rule, dueOn, todayIso), todayIso.slice(0, 4))}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <Eyebrow>Goal</Eyebrow>
          <select value={draft.goal} onChange={set('goal')} className={field}>
            <option value="">{inherited ? 'Inherit from project' : 'No goal'}</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
          {inherited && (
            <span className="text-subheadline text-secondary-label">
              Counts toward the project&apos;s goal, {inherited.title}, unless a goal is set here.
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <Eyebrow>Notes</Eyebrow>
          <textarea
            value={draft.notes}
            onChange={set('notes')}
            onKeyDown={submitOnModEnter}
            rows={4}
            placeholder="Context, links, acceptance…"
            className={cn(field, 'resize-y leading-[1.5]')}
          />
        </label>

        <div>
          <Eyebrow>Linked skills</Eyebrow>
          {task?.entityRef ? (
            <SkillPicker entityRef={task.entityRef} links={task.skills} skills={skills} className="mt-2" />
          ) : (
            <p className="mt-2 text-footnote text-secondary-label">Classified when it is created.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card bg-grouped-2 [&>*]:shadow-[-1px_-1px_0_var(--separator)]">
          <div className="px-4 py-3">
            <Eyebrow>Source</Eyebrow>
            <div
              className={cn(
                'num mt-1 text-subheadline',
                task?.source.startsWith('agent') ? 'text-orange-text' : 'text-label',
              )}
            >
              {task?.source ?? 'manual'}
            </div>
          </div>
          <div className="px-4 py-3">
            <Eyebrow>Reminder channel</Eyebrow>
            <div className="num mt-1 text-subheadline text-label">
              {reminderChannels ? reminderChannels.join(' · ') : 'Off'} ·{' '}
              <Link href="/settings/notifications" className="text-accent hover:underline">
                change
              </Link>
            </div>
          </div>
        </div>
      </form>
    </Overlay>
  )
}
