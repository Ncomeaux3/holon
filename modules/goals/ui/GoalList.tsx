'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { ActionButton, CHEVRON, Eyebrow, STRETCH, STRETCH_WRAP, StatusChip, fieldClass, useToast, type ChipTone, type SkillLink } from '@/components/pos'
import { actionButtonBase, actionButtonSizes, actionButtonVariants } from '@/components/pos/Button'
import { Segments } from '@/components/pos/Segments'
import { useIsPhone } from '@/components/pos/useIsPhone'
import { useSearchState } from '@/components/pos/searchState'
import type { LinkedItem } from '@/core/module-contract'
import { parseNumber } from '@/core/numbers'
import type { Metric } from '@/core/metrics'
import { cn } from '@/lib/utils'
import { formatValue, type GoalKind, type Point, type Progress, type Status } from '../progress'
import { recordCheckin, writeGoal, type ActionResult } from './actions'
import { GoalDrawer } from './GoalDrawer'

export type GoalCard = {
  id: string
  title: string
  notes: string
  area: string
  kind: GoalKind
  unit: string
  startValue: number
  targetValue: number
  deadline: string
  ageInDays: number
  metricSource: string | null
  archived: boolean
  history: Point[]
  progress: Progress
  rule: string
  tasks: LinkedItem[]
  entityRef: string | null
  skills: SkillLink[]
  proposals: { id: string; from: string; title: string }[]
}

// The status colours: positive, attention, risk, and the action colour for done.
export const STATUS_TEXT: Record<Status, string> = {
  done: 'Done',
  on_track: 'On track',
  at_risk: 'At risk',
  stalled: 'Stalled',
}
const STATUS_TONE: Record<Status, ChipTone> = {
  done: 'brand',
  on_track: 'ok',
  at_risk: 'warn',
  stalled: 'bad',
}

/** The state badge on a card and in the drawer. */
export function StatusMark({ status, className }: { status: Status; className?: string }) {
  return (
    <StatusChip tone={STATUS_TONE[status]} className={cn('shrink-0 whitespace-nowrap', className)}>
      {STATUS_TEXT[status]}
    </StatusChip>
  )
}
const STATUS_STROKE: Record<Status, string> = {
  done: 'var(--accent)',
  on_track: 'var(--green)',
  at_risk: 'var(--orange)',
  stalled: 'var(--red)',
}
// The accessible shades: system green and orange are under 3:1 on a white card.
const STATUS_BG: Record<Status, string> = {
  done: 'bg-accent',
  on_track: 'bg-green-text',
  at_risk: 'bg-orange-text',
  stalled: 'bg-red-text',
}

export const KIND_LABEL: Record<GoalKind, string> = {
  number: 'Numeric target',
  count: 'Count',
  streak: 'Habit · weekly',
  milestone: 'Milestone',
}

/** The artboard's life areas, in its order; anything else the data has follows. */
export const AREAS = ['Engineering', 'Business', 'Communication', 'Health', 'Life ops']

/** The small buttons, as ActionButton draws them: the Normal tint, and the selected accent tint. */
export const mini = cn(actionButtonBase, actionButtonSizes.sm, actionButtonVariants.outline)
export const miniAccent = cn(actionButtonBase, actionButtonSizes.sm, actionButtonVariants.brand)
export const field = fieldClass

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Sep 28", with the year only when it is not this one. */
export function formatDate(iso: string, todayIso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  const sameYear = iso.slice(0, 4) === todayIso.slice(0, 4)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${sameYear ? '' : ` ${d.getFullYear()}`}`
}

/** Where a projection lands, always with the year, or the honest answer. */
export function projectionLabel(days: number | null, todayIso: string): string {
  if (days === null) return 'never at this pace'
  const d = new Date(`${todayIso}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`
}

/** The card's finish clause and its colour: green when it lands before the deadline. */
export function finish(goal: GoalCard, todayIso: string): { text: string; ok: boolean } | null {
  const p = goal.progress
  if (p.status === 'done') return { text: 'done', ok: true }
  if (goal.kind === 'milestone') return null
  return {
    text: projectionLabel(p.projected30, todayIso),
    ok: p.projected30 !== null && p.projected30 <= p.daysLeft,
  }
}

export function checkinPlaceholder(unit: string): string {
  return unit === '$' ? '$ value' : unit || 'value'
}

function useParams() {
  const { params, set: setParams } = useSearchState()
  return { params, setParams }
}

/** "Goals / Active", the band's crumb. */
export function GoalsCrumb() {
  const { params } = useParams()
  return (
    <>
      Goals <span className="text-secondary-label">/</span>{' '}
      {params.get('tab') === 'archive' ? 'Archive' : 'Active'}
    </>
  )
}

/** The title block's "New goal →": the drawer in new mode, in the URL. */
export function NewGoalButton() {
  const { setParams } = useParams()
  return (
    <ActionButton
      variant="solid"
      className="gap-2 px-3.5"
      onClick={() => setParams({ goal: 'new', edit: null }, { push: true })}
    >
      New goal <span aria-hidden="true">&rarr;</span>
    </ActionButton>
  )
}

export function GoalList({
  goals,
  metrics,
  skills,
  todayIso,
}: {
  goals: GoalCard[]
  metrics: Metric[]
  skills: [string, string][]
  todayIso: string
}) {
  // Tab, open goal and its mode live in the URL, so a goal can be linked to
  // and all of it survives a refresh. It is also what makes a screenshot of
  // the drawer actually be one: the theme switch reloads, and client state
  // does not come back.
  const { params, setParams } = useParams()
  const tab = params.get('tab') === 'archive' ? 'archive' : 'active'
  const drawer = params.get('goal')
  const selected = goals.find((g) => g.id === drawer) ?? null

  const [, start] = useTransition()
  const toast = useToast()

  const run = (action: () => Promise<ActionResult>, ok?: string) =>
    start(async () => {
      const result = await action()
      if (!result.ok) toast(result.error)
      else if (ok) toast(ok)
    })

  const shown = goals.filter((g) => (tab === 'archive' ? g.archived : !g.archived))
  const areas = [...AREAS, ...shown.map((g) => g.area)].filter(
    (a, i, all) => all.indexOf(a) === i && shown.some((g) => g.area === a),
  )

  return (
    <div>
      <Segments
        label="Goal status"
        value={tab}
        tabClassName="px-3.5"
        onChange={(next) => setParams({ tab: next === 'active' ? null : next, goal: null, edit: null })}
        tabs={[
          { value: 'active', label: 'Active', count: goals.filter((g) => !g.archived).length },
          { value: 'archive', label: 'Archive', count: goals.filter((g) => g.archived).length },
        ]}
      >
        <div className="flex flex-col gap-[22px] pt-[18px]">
          {/* A goal is three fields, so the artboard adds one here rather than
            * behind a screen of its own. More options opens the drawer, where the
            * unit, the kind and the metric source live. */}
          {tab === 'active' && (
            <AddGoal
              todayIso={todayIso}
              open={params.get('new') === '1'}
              onOpen={(on) => setParams({ new: on ? '1' : null })}
              onMore={(draft) =>
                setParams(
                  {
                    new: null,
                    goal: 'new',
                    edit: null,
                    title: draft.title || null,
                    target: draft.target || null,
                    deadline: draft.deadline || null,
                  },
                  { push: true },
                )
              }
              onRun={run}
            />
          )}

          {shown.length === 0 ? (
            <p className="p-10 text-center text-footnote text-secondary-label">Nothing here yet.</p>
          ) : (
            areas.map((area) => {
              const inArea = shown.filter((g) => g.area === area)
              const onTrack = inArea.filter(
                (g) => g.progress.status === 'on_track' || g.progress.status === 'done',
              ).length

              return (
                <section key={area}>
                  <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-separator pb-2">
                    <span className="text-subheadline text-label">{area}</span>
                    <span className="num text-caption-1 text-secondary-label">
                      {inArea.length} {inArea.length === 1 ? 'goal' : 'goals'} · {onTrack} on track
                    </span>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3.5">
                    {inArea.map((goal) => (
                      <Card
                        key={goal.id}
                        goal={goal}
                        todayIso={todayIso}
                        onOpen={() => setParams({ goal: goal.id, edit: null }, { push: true })}
                        onRun={run}
                      />
                    ))}
                  </div>
                </section>
              )
            })
          )}
        </div>
      </Segments>

      {drawer !== null && (
        <GoalDrawer
          goal={selected}
          isNew={drawer === 'new'}
          editing={params.get('edit') === '1'}
          draft={{
            title: params.get('title') ?? '',
            target: params.get('target') ?? '',
            deadline: params.get('deadline') ?? '',
            area: params.get('area') ?? '',
            unit: params.get('unit') ?? '',
            metric: params.get('metric') ?? '',
          }}
          metrics={metrics}
          skills={skills}
          todayIso={todayIso}
          onClose={() =>
            setParams({ goal: null, edit: null, title: null, target: null, deadline: null, area: null, unit: null, metric: null })
          }
          onEdit={(on) => setParams({ edit: on ? '1' : null })}
          onRun={run}
        />
      )}
    </div>
  )
}

/**
 * Add a goal in three fields, on the page.
 *
 * Closed it is a dashed line you press. Open it is title, target and deadline,
 * which is the least a goal can be: a target with no deadline has no pace, and
 * pace is the whole of what this screen reads.
 */
function AddGoal({
  todayIso,
  open,
  onOpen,
  onMore,
  onRun,
}: {
  todayIso: string
  /** In the URL, so it survives the theme toggle's reload. */
  open: boolean
  onOpen: (on: boolean) => void
  onMore: (draft: { title: string; target: string; deadline: string }) => void
  onRun: (action: () => Promise<ActionResult>, ok?: string) => void
}) {
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('')
  const [deadline, setDeadline] = useState('')
  const isPhone = useIsPhone()

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpen(true)}
        className="min-h-11 w-full rounded-card border border-dashed border-gray-3 px-4 py-3 text-left text-footnote text-secondary-label transition-colors duration-150 hover:border-accent hover:text-label"
      >
        + Add a goal inline
      </button>
    )
  }

  const targetValue = parseNumber(target) ?? 0
  const ready = title.trim() !== '' && targetValue > 0 && deadline !== ''

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        // The phone shows only the title; submitting it is the same as
        // pressing "More options" on the desktop form. onMore closes the
        // inline form itself; a second URL write here would drop the drawer.
        if (isPhone) {
          if (title.trim()) onMore({ title, target, deadline })
          return
        }
        if (!ready) return
        onRun(
          () => writeGoal({ title: title.trim(), target_value: targetValue, deadline }),
          `Added. ${title.trim()}`,
        )
        setTitle('')
        setTarget('')
        setDeadline('')
        onOpen(false)
      }}
      className="grid gap-2.5 rounded-card border border-dashed border-accent px-4 py-3.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
    >
      <label className="flex flex-col gap-1.5">
        <Eyebrow>Goal</Eyebrow>
        <input
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Run a half marathon"
          className={field}
        />
      </label>
      <label className="hidden flex-col gap-1.5 md:flex">
        <Eyebrow>Target</Eyebrow>
        <input
          inputMode="decimal"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="21.1"
          className={cn(field, 'num')}
        />
      </label>
      <label className="hidden flex-col gap-1.5 md:flex">
        <Eyebrow>Deadline</Eyebrow>
        <input
          type="date"
          value={deadline}
          min={todayIso}
          onChange={(e) => setDeadline(e.target.value)}
          className={cn(field, 'num')}
        />
      </label>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="submit"
          disabled={isPhone ? !title.trim() : !ready}
          className={miniAccent}
        >
          {isPhone ? 'Next' : 'Add'}
        </button>
        <button
          type="button"
          onClick={() => onMore({ title, target, deadline })}
          className={cn(mini, isPhone && 'hidden')}
        >
          More options…
        </button>
        <button type="button" onClick={() => onOpen(false)} className={mini}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** The artboard's 80 by 28 sparkline: the history, oldest left, in the status colour. */
function Spark({ history, status }: { history: Point[]; status: Status }) {
  const h = [...history].sort((a, b) => b.daysAgo - a.daysAgo)
  if (h.length < 2) return <span className="block h-7 w-20 shrink-0" aria-hidden />
  const lo = Math.min(...h.map((p) => p.value))
  const hi = Math.max(...h.map((p) => p.value))
  const maxAgo = h[0].daysAgo || 1
  const d = h
    .map(
      (p, i) =>
        `${i ? 'L' : 'M'}${(80 - (p.daysAgo / maxAgo) * 80).toFixed(1)},${(26 - ((p.value - lo) / (hi - lo || 1)) * 24).toFixed(1)}`,
    )
    .join(' ')
  return (
    <svg viewBox="0 0 80 28" className="h-7 w-20 shrink-0 overflow-visible" aria-hidden>
      <path d={d} fill="none" stroke={STATUS_STROKE[status]} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Card({
  goal,
  todayIso,
  onOpen,
  onRun,
}: {
  goal: GoalCard
  todayIso: string
  onOpen: () => void
  onRun: (action: () => Promise<ActionResult>, ok?: string) => void
}) {
  const p = goal.progress
  const [value, setValue] = useState('')
  // Struck through the moment Mark done or Reopen is pressed, reverted on
  // failure, same shape as Inbox.tsx's act() with a boolean instead of a list.
  const [doneOverride, setDoneOverride] = useState<boolean | null>(null)
  const next = goal.tasks.find((t) => !t.done)
  const fin = finish(goal, todayIso)
  const manual = !goal.metricSource
  const done = doneOverride ?? p.status === 'done'

  return (
    // The title button's hit area is stretched over the whole card; the task
    // link and the check-in controls below sit above it (v1.2 phase 3d).
    <article className={cn(STRETCH_WRAP, 'min-w-0 rounded-card bg-grouped-2 px-[18px] py-4 transition-[background-color,transform] duration-200 hover:-translate-y-0.5')}>
      <div className="flex items-start justify-between gap-2.5">
        <button type="button" onClick={onOpen} className={cn(STRETCH, 'min-w-0 text-left')}>
          <span className="block text-subheadline font-medium text-label">{goal.title}</span>
          <span className="mt-0.5 block text-footnote text-secondary-label">
            {KIND_LABEL[goal.kind]} · {manual ? 'check-ins' : 'computed'}
          </span>
        </button>
        <span className="flex shrink-0 items-center gap-2">
          <StatusMark status={p.status} />
          <span aria-hidden="true" className={CHEVRON}>
            &rsaquo;
          </span>
        </span>
      </div>

      <div className="mt-3.5 flex items-baseline justify-between gap-2.5">
        <span className="num text-title-2 font-semibold text-label">
          {formatValue(p.current, goal.kind, goal.unit)}{' '}
          <span className="text-footnote font-normal text-secondary-label">/ {formatValue(goal.targetValue, goal.kind, goal.unit)}</span>
        </span>
        <span className="num text-footnote text-secondary-label">{Math.round(p.percent)}%</span>
      </div>

      {/* The mark is where a straight line from the start would have you today,
          so the bar shows pace rather than only distance. */}
      <div className="relative mt-2.5 h-1 rounded-full bg-fill-3">
        <div className={cn('h-full rounded-full', STATUS_BG[p.status])} style={{ width: `${p.percent}%` }} />
        <span
          title="Where you should be today"
          className="absolute -top-[3px] h-[9px] w-px bg-secondary-label"
          style={{ left: `${Math.min(100, p.expectedPercent)}%` }}
        />
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-3">
        <div className="min-w-0">
          <p className="text-footnote text-secondary-label">{goal.rule}</p>
          <p className="mt-1 text-footnote text-secondary-label">
            Deadline <span className="text-label">{formatDate(goal.deadline, todayIso)}</span> ·{' '}
            <span className="text-label">
              {p.daysLeft >= 0 ? `${p.daysLeft} days left` : `${-p.daysLeft} days over`}
            </span>
            {fin && (
              <>
                {' '}· finish ≈ <span className={fin.ok ? 'text-green-text' : 'text-orange-text'}>{fin.text}</span>
              </>
            )}
          </p>
        </div>
        <Spark history={goal.history} status={p.status} />
      </div>

      <div className="relative z-10 mt-3 flex items-center justify-between gap-2.5 border-t border-separator pt-2.5">
        <Link
          href="/tasks?view=goal"
          // The padding reaches 44px; the negative margin keeps the row's height.
          className="-my-3.5 min-w-0 truncate py-3.5 text-footnote text-secondary-label transition-colors duration-150 hover:text-accent"
        >
          {next
            ? `Next: ${next.title} · ${next.meta}`
            : goal.tasks.length
              ? 'All linked tasks done'
              : 'No linked tasks'}
        </Link>
        {manual && goal.kind !== 'milestone' && !goal.archived && (
          <form
            className="flex shrink-0 gap-1"
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
              className={cn(field, 'num w-[84px] px-2.5 py-1 text-footnote')}
            />
            <button type="submit" className={mini}>
              Check in
            </button>
          </form>
        )}
        {goal.kind === 'milestone' && !goal.archived && (
          <button
            type="button"
            className={miniAccent}
            onClick={() => {
              const nextDone = !done
              setDoneOverride(nextDone)
              onRun(async () => {
                const result = await recordCheckin(goal.id, nextDone ? 1 : 0)
                if (!result.ok) setDoneOverride(!nextDone)
                return result
              }, nextDone ? 'Marked done' : 'Reopened')
            }}
          >
            {done ? 'Reopen' : 'Mark done'}
          </button>
        )}
        {!manual && (
          <span className="code min-w-0 max-w-[60%] truncate text-footnote text-secondary-label">
            computed · {goal.metricSource}
          </span>
        )}
      </div>
    </article>
  )
}
