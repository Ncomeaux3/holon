// What the Tasks screen renders, and the bucketing behind its six views. No
// imports beyond the parser and core/clock.ts, which have none either: the board is a client
// component and anything reaching core/db.ts drags pg into the browser bundle.

import { dueLabel, estimateLabel, type Priority } from './quickadd'
import type { Repeat } from './repeat'
import { startOfWeek, type WeekStart } from '@/core/clock'

export type View = 'today' | 'week' | 'goal' | 'project' | 'review' | 'done'

export const VIEWS: { value: View; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'goal', label: 'By goal' },
  { value: 'project', label: 'By project' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
]

export type Task = {
  id: string
  title: string
  notes: string
  /** Days from today. Null is no date, which is a state, not a zero. */
  dueInDays: number | null
  dueAt: string | null
  priority: Priority
  status: 'open' | 'review' | 'done'
  projectId: string | null
  projectName: string | null
  /** The goal it counts toward: its own, else its project's. */
  goalRef: string | null
  goalTitle: string | null
  ownGoalRef: string | null
  projectGoalRef: string | null
  estimateMinutes: number | null
  remindMinutes: number | null
  /** The rule a repeating task comes back by. Null for a one-off. */
  repeat: Repeat | null
  source: string
  /** The registry row the skill links hang off. Null for a task registered before the registry. */
  entityRef: string | null
  /** What the classifier or the owner linked, named by the tree. Empty when nothing matched. */
  skills: { id: string; name: string; confidence: number; by: 'rule' | 'model' | 'manual' }[]
  /** Days ago it was completed. Null while it is open. */
  doneDaysAgo: number | null
}

export type Bucket = 'overdue' | 'today' | 'week' | 'later' | 'none'

/**
 * Overdue is its own bucket for counting and its own colour on a card, but it
 * sits in Today on the board: something that slipped is today's problem.
 * The week is the owner's calendar week, so `weekLeft` is the days after today
 * it still has (daysLeftInWeek): 6 on its first day, 0 on its last.
 */
export function bucket(dueInDays: number | null, weekLeft: number): Bucket {
  if (dueInDays === null) return 'none'
  if (dueInDays < 0) return 'overdue'
  if (dueInDays === 0) return 'today'
  if (dueInDays <= weekLeft) return 'week'
  return 'later'
}

/** Days after today left in the week that starts on `weekStart`. */
export function daysLeftInWeek(todayIso: string, weekStart: WeekStart): number {
  return 6 - Math.round((Date.parse(todayIso) - Date.parse(startOfWeek(todayIso, weekStart))) / 86_400_000)
}

export type Column = {
  id: string
  label: string
  /** What dropping a card here means. Null makes the column read only. */
  drop: Record<string, unknown> | null
  empty: string
  tone: 'ink' | 'ink-2' | 'ink-3' | 'warn' | 'ok'
  tasks: Task[]
  /** "4 · 4.2h" under the heading. */
  meta: string
}

/** "2h 10m", "45m", "". The board's per-column load. */
export function loadLabel(minutes: number): string {
  if (minutes === 0) return ''
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** "4.2 h", "45 min", "". A column's load, hours to one decimal, spelled as the mockup has it. */
export function hoursLabel(minutes: number): string {
  if (minutes === 0) return ''
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`
}

/**
 * The reminder chip: "-30M", "-1D", or the time itself for a reminder at the
 * time. Null when there is no reminder, or one at the time of a task with no
 * time, which is a reminder that can never fire.
 */
export function remindLabel(minutes: number | null, dueAt: string | null): string | null {
  if (minutes === null) return null
  if (minutes === 0) return dueAt
  if (minutes % 1440 === 0) return `-${minutes / 1440}D`
  if (minutes % 60 === 0) return `-${minutes / 60}H`
  return `-${minutes}M`
}

const isOpen = (t: Task) => t.status === 'open'

/**
 * Priority first inside a column, then time of day, then the day itself. A P1
 * with no time still sorts above a P3 at 09:00, because the column is already
 * one day's worth of work and priority is what decides the order within it.
 */
function order(a: Task, b: Task): number {
  if (a.priority !== b.priority) return a.priority.localeCompare(b.priority)
  const at = a.dueAt ?? '99:99'
  const bt = b.dueAt ?? '99:99'
  if (at !== bt) return at < bt ? -1 : 1
  return (a.dueInDays ?? 9999) - (b.dueInDays ?? 9999)
}

export function columnsFor(
  view: View,
  tasks: Task[],
  context: { projects: { id: string; name: string }[]; goals: { id: string; title: string }[]; weekLeft: number },
): Column[] {
  const bucketOf = (t: Task) => bucket(t.dueInDays, context.weekLeft)
  const build = (
    spec: Omit<Column, 'tasks' | 'meta'> & { filter: (t: Task) => boolean },
  ): Column => {
    const list = tasks.filter(spec.filter).sort(order)
    const load = hoursLabel(list.reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0))
    return {
      id: spec.id,
      label: spec.label,
      drop: spec.drop,
      empty: spec.empty,
      tone: spec.tone,
      tasks: list,
      meta: `${list.length} ${list.length === 1 ? 'task' : 'tasks'}${load ? `, about ${load}` : ''}`,
    }
  }

  if (view === 'today') {
    return [
      build({
        id: 'today',
        label: 'Today',
        tone: 'ink',
        drop: { dueInDays: 0 },
        empty: 'Nothing due today',
        filter: (t) => isOpen(t) && ['overdue', 'today'].includes(bucketOf(t)),
      }),
    ]
  }

  if (view === 'week') {
    return [
      build({
        id: 'today',
        label: 'Today',
        tone: 'ink',
        drop: { dueInDays: 0 },
        empty: 'Nothing due today',
        filter: (t) => isOpen(t) && ['overdue', 'today'].includes(bucketOf(t)),
      }),
      build({
        id: 'week',
        label: 'This week',
        tone: 'ink-2',
        // Four days out, as before, but never past the week's end; on its last
        // day there is nothing left to drop into.
        drop: context.weekLeft > 0 ? { dueInDays: Math.min(4, context.weekLeft) } : null,
        empty: 'Clear week',
        filter: (t) => isOpen(t) && bucketOf(t) === 'week',
      }),
      build({
        id: 'later',
        label: 'Later',
        tone: 'ink-3',
        drop: { dueInDays: 14 },
        empty: 'Nothing scheduled',
        filter: (t) => isOpen(t) && ['later', 'none'].includes(bucketOf(t)),
      }),
    ]
  }

  if (view === 'goal') {
    return [
      ...context.goals.map((g) =>
        build({
          id: g.id,
          label: g.title,
          tone: 'ink',
          drop: { goalRef: g.id },
          empty: 'No tasks toward this goal',
          filter: (t) => isOpen(t) && t.goalRef === g.id,
        }),
      ),
      build({
        id: 'no-goal',
        label: 'No goal',
        tone: 'ink-3',
        drop: { goalRef: null },
        empty: 'Everything is linked',
        filter: (t) => isOpen(t) && !t.goalRef,
      }),
    ]
  }

  if (view === 'project') {
    return [
      ...context.projects.map((p) =>
        build({
          id: p.id,
          label: p.name,
          tone: 'ink',
          drop: { projectId: p.id },
          empty: 'Empty',
          filter: (t) => isOpen(t) && t.projectId === p.id,
        }),
      ),
      build({
        id: 'no-project',
        label: 'No project',
        tone: 'ink-3',
        drop: { projectId: null },
        empty: 'Everything is filed',
        // Also a task whose project was archived: it has no column of its
        // own, and a task that vanishes from a view is not a view.
        filter: (t) => isOpen(t) && !context.projects.some((p) => p.id === t.projectId),
      }),
    ]
  }

  if (view === 'review') {
    return [
      build({
        id: 'review',
        label: 'Agent proposed, needs approval',
        tone: 'warn',
        drop: null,
        empty: 'No agent tasks waiting',
        filter: (t) => t.status === 'review',
      }),
      build({
        id: 'approved',
        label: 'Approved agent tasks',
        tone: 'ink-2',
        drop: null,
        empty: 'Approve one to see it here',
        filter: (t) => isOpen(t) && t.source === 'agent',
      }),
    ]
  }

  return [
    build({
      id: 'done-today',
      label: 'Done today',
      tone: 'ok',
      drop: null,
      empty: 'Nothing yet',
      filter: (t) => t.status === 'done' && t.doneDaysAgo === 0,
    }),
    build({
      id: 'done-week',
      label: 'Earlier this week',
      tone: 'ink-2',
      drop: null,
      empty: 'Nothing this week',
      filter: (t) => t.status === 'done' && (t.doneDaysAgo ?? 0) > 0,
    }),
  ]
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The line under a slipped item on the weekly review: when it was due, how
 * many times the nightly roll has moved it, and the project it belongs to.
 * A weekday for anything inside the week, the date past that, because "Due
 * Tue" three weeks on says less than it seems to.
 */
export function slipMeta({
  dueOn,
  today,
  rolls,
  project,
}: {
  dueOn: string
  today: string
  rolls: number
  project: string | null
}): string {
  const due = new Date(`${dueOn}T12:00:00`)
  const now = new Date(`${today}T12:00:00`)
  const daysAgo = Math.round((now.getTime() - due.getTime()) / 86_400_000)
  const when =
    daysAgo <= 0
      ? 'today'
      : daysAgo <= 6
        ? DAYS[due.getDay()]
        : `${due.getDate()} ${MONTHS[due.getMonth()]}`
  const rolled =
    rolls <= 0 ? null : rolls === 1 ? 'rolled once' : rolls === 2 ? 'rolled twice' : `rolled ${rolls} times`

  return [`Due ${when}`, rolled, project].filter(Boolean).join(' · ')
}

export { dueLabel, estimateLabel }
export type { Priority }
