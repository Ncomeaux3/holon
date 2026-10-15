'use client'

import Link from 'next/link'
import { useId, useState } from 'react'
import {
  ActionButton,
  Eyebrow,
  Field,
  Overlay,
  SkillPicker,
  StatusChip,
  submitOnModEnter,
  useFormErrors,
} from '@/components/pos'
import { SIZE } from '@/components/pos/button-classes'
import { ConfirmButton } from '@/components/pos/edit'
import type { Metric } from '@/core/metrics'
import { parseNumber } from '@/core/numbers'
import { cn } from '@/lib/utils'
import { formatValue, historyPaths, ruleLong, type GoalKind } from '../progress'
import { deleteGoal, recordCheckin, writeGoal, type ActionResult, type GoalInput } from './actions'
import {
  AREAS,
  KIND_LABEL,
  StatusMark,
  checkinPlaceholder,
  field,
  formatDate,
  mini,
  miniAccent,
  projectionLabel,
  type GoalCard,
} from './GoalList'

// The goal drawer, as the artboard draws it: a view with the numbers, the rule
// written out, the history, what is linked, and a footer with Edit, Archive
// and Delete; and an edit mode that is a form holding its edits until Save.
// New goal is the form with Create.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function GoalDrawer({
  goal,
  isNew,
  editing,
  draft,
  metrics,
  skills,
  todayIso,
  onClose,
  onEdit,
  onRun,
}: {
  goal: GoalCard | null
  isNew: boolean
  editing: boolean
  /** What the inline form had typed when More options was pressed. */
  draft: { title: string; target: string; deadline: string; area?: string; unit?: string; metric?: string }
  metrics: Metric[]
  skills: [string, string][]
  todayIso: string
  onClose: () => void
  onEdit: (on: boolean) => void
  onRun: (action: () => Promise<ActionResult>, ok?: string) => void
}) {
  if (isNew || (goal && editing)) {
    return (
      <Form
        goal={isNew ? null : goal}
        draft={draft}
        metrics={metrics}
        onCancel={() => (isNew ? onClose() : onEdit(false))}
        onRun={onRun}
        onSaved={() => (isNew ? onClose() : onEdit(false))}
      />
    )
  }
  if (!goal) return null
  return <View goal={goal} skills={skills} todayIso={todayIso} onClose={onClose} onEdit={() => onEdit(true)} onRun={onRun} />
}

function View({
  goal,
  skills,
  todayIso,
  onClose,
  onEdit,
  onRun,
}: {
  goal: GoalCard
  skills: [string, string][]
  todayIso: string
  onClose: () => void
  onEdit: () => void
  onRun: (action: () => Promise<ActionResult>, ok?: string) => void
}) {
  const p = goal.progress
  const [value, setValue] = useState('')
  const manual = !goal.metricSource
  const shape = {
    kind: goal.kind,
    startValue: goal.startValue,
    targetValue: goal.targetValue,
    deadlineInDays: p.daysLeft,
    ageInDays: goal.ageInDays,
    history: goal.history,
  }
  const chart = historyPaths(shape, p)
  const startDate = new Date(`${todayIso}T12:00:00`)
  startDate.setDate(startDate.getDate() - chart.spanDays)
  const proj = (days: number | null) =>
    p.status === 'done'
      ? { text: 'done', ok: true }
      : goal.kind === 'milestone'
        ? null
        : { text: projectionLabel(days, todayIso), ok: days !== null && days <= p.daysLeft }
  const proj30 = proj(p.projected30)
  const projAll = proj(p.projectedAll)
  const doneTasks = goal.tasks.filter((t) => t.done).length

  return (
    <Overlay
      open
      onClose={onClose}
      eyebrow={
        <>
          Goals <span className="text-secondary-label">/</span> {goal.title}
        </>
      }
      footer={
        <>
          <div className="flex gap-2">
            <button type="button" onClick={onEdit} className={mini}>
              Edit
            </button>
            <button
              type="button"
              onClick={() => {
                onRun(() => writeGoal({ id: goal.id, archived: !goal.archived }), goal.archived ? 'Unarchived' : 'Archived')
                onClose()
              }}
              className={mini}
            >
              {goal.archived ? 'Unarchive' : 'Archive'}
            </button>
          </div>
          <ConfirmButton
            confirmLabel="Delete"
            title="Delete this goal?"
            onConfirm={() => {
              onRun(() => deleteGoal(goal.id), 'Deleted')
              onClose()
            }}
            className={SIZE.sm}
          >
            Delete
          </ConfirmButton>
        </>
      }
    >
      <div className="flex flex-col gap-[18px]">
        <div>
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-title-2 text-label">{goal.title}</h2>
            <StatusMark status={p.status} className="mt-1" />
          </div>
          <p className="mt-1.5 text-footnote text-secondary-label">
            {goal.area} · {KIND_LABEL[goal.kind]} · {manual ? 'check-ins' : 'computed'}
          </p>
          {goal.notes && <p className="mt-2.5 text-subheadline text-label">{goal.notes}</p>}
        </div>

        {/* The gaps are the hairlines: opaque cells over a separator fill. */}
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-card bg-separator">
          <Cell label="Now" value={formatValue(p.current, goal.kind, goal.unit)} />
          <Cell label="Target" value={formatValue(goal.targetValue, goal.kind, goal.unit)} />
          <Cell label={p.daysLeft >= 0 ? 'Days left' : 'Days over'} value={String(Math.abs(p.daysLeft))} />
        </div>

        <div className="flex flex-col gap-2 rounded-card bg-grouped-2 px-3.5 py-3">
          <Eyebrow>Status rule</Eyebrow>
          <p className="text-footnote text-label">
            {ruleLong(shape, p, goal.unit, formatDate(goal.deadline, todayIso))}
          </p>
          {proj30 && projAll && (
            <div className="grid grid-cols-2 gap-3 text-footnote text-secondary-label">
              <span>
                Projected · last 30d pace
                <span className={cn('mt-0.5 block', proj30.ok ? 'text-green-text' : 'text-orange-text')}>{proj30.text}</span>
              </span>
              <span>
                Projected · all history
                <span className={cn('mt-0.5 block', projAll.ok ? 'text-green-text' : 'text-orange-text')}>{projAll.text}</span>
              </span>
            </div>
          )}
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <Eyebrow>History</Eyebrow>
            <span className="num text-caption-1 text-secondary-label">
              {goal.history.length} points · {manual ? 'check-ins' : 'nightly snapshots'}
            </span>
          </div>
          <svg viewBox="0 0 400 110" preserveAspectRatio="none" className="mt-2 block h-[110px] w-full overflow-visible" aria-hidden>
            <line x1="0" y1={chart.targetY} x2="400" y2={chart.targetY} stroke="var(--gray)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
            <line x1="0" y1={chart.paceY1} x2="400" y2={chart.paceY2} stroke="var(--gray)" vectorEffect="non-scaling-stroke" />
            <path d={chart.area} fill="var(--accent)" fillOpacity={0.15} />
            <path d={chart.path} fill="none" stroke="var(--accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            {chart.dots.map((d, i) => (
              <circle key={i} cx={d.x} cy={d.y} r={2.5} fill={d.manual ? 'var(--label)' : 'var(--accent)'} stroke="var(--secondary-system-grouped-background)" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          <div className="mt-1 flex justify-between text-caption-1 text-secondary-label">
            <span>{`${MONTHS[startDate.getMonth()]} ${startDate.getDate()}`}</span>
            <span>dashed = target · solid = needed pace</span>
            <span>Today</span>
          </div>
          {manual && goal.kind !== 'milestone' && (
            <form
              className="mt-3 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                const n = parseNumber(value)
                if (n === null) return
                onRun(() => recordCheckin(goal.id, n), 'Checked in')
                setValue('')
              }}
            >
              <input
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-label={`Check in on ${goal.title}`}
                placeholder={checkinPlaceholder(goal.unit)}
                className={cn(field, 'num min-w-0 flex-1')}
              />
              <button type="submit" className={miniAccent}>
                Check in
              </button>
            </form>
          )}
          {manual && goal.kind === 'milestone' && (
            <button
              type="button"
              className={cn(miniAccent, 'mt-3')}
              onClick={() =>
                onRun(() => recordCheckin(goal.id, p.status === 'done' ? 0 : 1), p.status === 'done' ? 'Reopened' : 'Marked done')
              }
            >
              {p.status === 'done' ? 'Reopen' : 'Mark done'}
            </button>
          )}
          {!manual && (
            <p className="mt-2.5 text-caption-1 text-secondary-label">
              Computed nightly from <span className="num">{goal.metricSource}</span>. Manual check-ins are disabled while a source is set.
            </p>
          )}
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <Eyebrow>Linked tasks</Eyebrow>
            <Link href="/tasks?view=goal" className="-my-3.5 py-3.5 text-footnote text-secondary-label hover:text-label">
              {doneTasks} / {goal.tasks.length} done →
            </Link>
          </div>
          <div className="mt-1.5 flex flex-col">
            {goal.tasks.length === 0 && <p className="py-2 text-footnote text-secondary-label">No task points at this goal yet.</p>}
            {goal.tasks.map((t, i) => (
              <div key={i} className="flex items-baseline justify-between gap-2.5 border-b border-separator py-2 text-subheadline">
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cn('size-3 shrink-0 border rounded-full', t.done ? 'border-accent bg-accent' : 'border-gray')} />
                  <span className={cn('truncate', t.done ? 'text-secondary-label line-through' : 'text-label')}>{t.title}</span>
                </span>
                <span className="num shrink-0 text-caption-1 text-secondary-label">{t.meta}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <Eyebrow>Linked skills</Eyebrow>
          {goal.entityRef ? (
            <SkillPicker entityRef={goal.entityRef} links={goal.skills} skills={skills} className="mt-2" />
          ) : (
            <p className="mt-2 text-footnote text-secondary-label">Nothing matched yet.</p>
          )}
        </div>

        {goal.proposals.length > 0 && (
          <div>
            <div className="flex items-baseline justify-between">
              <Eyebrow>Agent proposals</Eyebrow>
              <Link href="/review" className="-my-3.5 py-3.5 text-footnote text-secondary-label hover:text-label">
                Review →
              </Link>
            </div>
            <div className="mt-1.5 flex flex-col">
              {goal.proposals.map((pr) => (
                <div key={pr.id} className="border-b border-separator py-2">
                  <div className="flex justify-between gap-2.5">
                    <span className="text-caption-1 text-secondary-label">{pr.from}</span>
                    <StatusChip tone="warn">Pending</StatusChip>
                  </div>
                  <div className="mt-[3px] text-subheadline text-label">{pr.title}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Overlay>
  )
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-grouped-2 px-4 py-3">
      <Eyebrow>{label}</Eyebrow>
      <div className="num mt-1 text-title-3 font-semibold text-label">{value}</div>
    </div>
  )
}

function Form({
  goal,
  draft,
  metrics,
  onCancel,
  onRun,
  onSaved,
}: {
  goal: GoalCard | null
  draft: { title: string; target: string; deadline: string; area?: string; unit?: string; metric?: string }
  metrics: Metric[]
  onCancel: () => void
  onRun: (action: () => Promise<ActionResult>, ok?: string) => void
  onSaved: () => void
}) {
  const initial = {
    title: goal?.title ?? draft.title,
    kind: (goal?.kind ?? 'number') as GoalKind,
    area: goal?.area ?? (draft.area || 'Life ops'),
    target: goal ? String(goal.targetValue) : draft.target,
    unit: goal?.unit ?? draft.unit ?? '',
    deadline: goal?.deadline ?? draft.deadline,
    start: goal ? String(goal.startValue) : '0',
    metric: goal?.metricSource ?? draft.metric ?? '',
    notes: goal?.notes ?? '',
  }
  const [d, setD] = useState(initial)
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => d[k] !== initial[k])
  const set = (key: keyof typeof d) => (e: { target: { value: string } }) =>
    setD((prev) => ({ ...prev, [key]: e.target.value }))
  const milestone = d.kind === 'milestone'
  const target = parseNumber(d.target) ?? 0
  const formId = useId()
  const { errors, ref: formRef, submit } = useFormErrors(() => ({
    title: d.title.trim() ? undefined : 'Title is required',
    deadline: d.deadline ? undefined : 'Deadline is required',
    target: milestone
      ? undefined
      : !d.target.trim()
        ? 'Target is required'
        : target > 0
          ? undefined
          : 'Target must be a number above zero',
    start: milestone || !d.start.trim() || parseNumber(d.start) !== null ? undefined : 'Starting value must be a number',
  }))

  const save = () => {
    if (!submit()) return
    const input: GoalInput = {
      ...(goal && { id: goal.id }),
      title: d.title.trim(),
      kind: d.kind,
      area: d.area,
      unit: milestone ? '' : d.unit,
      target_value: milestone ? 1 : target,
      start_value: milestone ? 0 : (parseNumber(d.start) ?? 0),
      deadline: d.deadline,
      metric_source: d.metric || null,
      notes: d.notes,
    }
    onRun(() => writeGoal(input), goal ? 'Saved' : `Added. ${d.title.trim()}`)
    onSaved()
  }

  const areas = AREAS.includes(d.area) ? AREAS : [...AREAS, d.area]

  return (
    <Overlay
      open
      onClose={onCancel}
      dirty={dirty}
      eyebrow={
        <>
          Goals <span className="text-secondary-label">/</span> {goal ? 'Edit' : 'New goal'}
        </>
      }
      footer={
        <>
          <ActionButton variant="quiet" onClick={onCancel}>
            Cancel
          </ActionButton>
          <ActionButton variant="solid" className="gap-2 px-3.5" type="submit" form={formId}>
            {goal ? 'Save' : 'Create'} <span aria-hidden="true">&rarr;</span>
          </ActionButton>
        </>
      }
    >
      <form
        id={formId}
        ref={formRef}
        className="flex flex-col gap-[18px]"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Field label="Title" required error={errors.title}>
          <input value={d.title} onChange={set('title')} className={cn(field, 'px-3 py-2.5')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <Eyebrow>Type</Eyebrow>
            <select value={d.kind} onChange={set('kind')} className={field}>
              <option value="number">Numeric target</option>
              <option value="count">Count</option>
              <option value="streak">Habit · per week</option>
              <option value="milestone">Milestone</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <Eyebrow>Life area</Eyebrow>
            <select value={d.area} onChange={set('area')} className={field}>
              {areas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          {!milestone && (
            <>
              <Field label={d.kind === 'streak' ? 'Times per week' : 'Target'} required error={errors.target}>
                <input inputMode="decimal" value={d.target} onChange={set('target')} className={cn(field, 'num')} />
              </Field>
              <label className="flex flex-col gap-1.5">
                <Eyebrow>Unit</Eyebrow>
                <input value={d.unit} onChange={set('unit')} placeholder="$, lb, books, /wk" className={cn(field, 'num')} />
              </label>
            </>
          )}
          <Field label="Deadline" required error={errors.deadline}>
            <input type="date" value={d.deadline} onChange={set('deadline')} className={cn(field, 'num py-2')} />
          </Field>
          {!milestone && (
            <Field label="Starting value" error={errors.start}>
              <input inputMode="decimal" value={d.start} onChange={set('start')} className={cn(field, 'num')} />
            </Field>
          )}
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <Eyebrow>Metric source · optional</Eyebrow>
            <span className="text-caption-1 text-secondary-label">progress is computed when set</span>
          </div>
          <select
            value={d.metric}
            onChange={set('metric')}
            aria-label="Metric source"
            className={cn(field, 'mt-2 text-footnote')}
          >
            <option value="">Manual check-ins</option>
            {metrics.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {m.id}
              </option>
            ))}
            {d.metric && !metrics.some((m) => m.id === d.metric) && (
              <option value={d.metric}>{d.metric} (not registered)</option>
            )}
          </select>
        </div>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Notes</Eyebrow>
          <textarea
            value={d.notes}
            onChange={set('notes')}
            onKeyDown={submitOnModEnter}
            rows={3}
            className={cn(field, 'resize-y px-3 py-2.5 leading-[1.5]')}
          />
        </label>
      </form>
    </Overlay>
  )
}
