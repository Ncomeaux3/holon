import { db } from '@/core/db'
import { ownerToday } from '@/core/today'
import { progress, rule, type Goal, type GoalKind, type Point, type Progress } from './progress'

// Reads for the screen and the digest. The shape it renders and the arithmetic
// over it live in ./progress.ts, which a client component can import.

export type GoalRow = {
  id: string
  title: string
  notes: string
  area: string
  kind: GoalKind
  unit: string
  start_value: string
  target_value: string
  deadline: string
  metric_source: string | null
  archived: boolean
  created_at: Date
}

export async function listGoals(includeArchived = true): Promise<GoalRow[]> {
  const { rows } = await db().query<GoalRow>(
    `select id, title, notes, area, kind, unit, start_value, target_value,
            deadline::text, metric_source, archived, created_at
       from goals.goal
      where $1 or archived = false
      order by archived, deadline`,
    [includeArchived],
  )
  return rows
}

/**
 * Every check-in, as days ago and a value, which is the shape progress() takes.
 * Days are computed against the owner's date, not the database's, so a check-in
 * entered this evening is zero days ago rather than one.
 */
export async function historyByGoal(): Promise<Map<string, Point[]>> {
  const { rows } = await db().query<{
    goal_id: string
    days_ago: number
    value: string
    is_manual: boolean
  }>(
    `select goal_id,
            (core.today() - occurred_on)::int as days_ago,
            value::text, is_manual
       from goals.checkin
      order by occurred_on`,
  )

  const map = new Map<string, Point[]>()
  for (const r of rows) {
    const point = { daysAgo: r.days_ago, value: Number(r.value), manual: r.is_manual }
    map.set(r.goal_id, [...(map.get(r.goal_id) ?? []), point])
  }
  return map
}

export async function checkIn(args: {
  goalId: string
  value: number
  note?: string
  occurredOn?: string
  isManual?: boolean
}): Promise<void> {
  await db().query(
    `insert into goals.checkin (goal_id, value, note, occurred_on, is_manual)
     values ($1, $2, $3, coalesce($4::date, core.today()), $5)
     on conflict (goal_id, occurred_on) do update
       set value = excluded.value,
           note = excluded.note,
           -- A hand entered reading overrules a computed one, and the nightly
           -- job must never take it back. Manual only ever goes true.
           is_manual = goals.checkin.is_manual or excluded.is_manual
     -- The latch above kept the flag but not the number: pullMetrics writes
     -- is_manual false onto today's row, which is the same row the owner may
     -- already have typed by hand, and set value = excluded.value took it back.
     -- Same guard core.skill_links uses, plus the case that flag alone missed:
     -- the owner correcting their own reading is still a manual write.
     where goals.checkin.is_manual = false or excluded.is_manual`,
    [args.goalId, args.value, args.note ?? '', args.occurredOn ?? null, args.isManual ?? true],
  )
}

/**
 * The columns a patch is allowed to name.
 *
 * Not the type restated: patchGoal builds its SET clause by interpolating
 * column names and is reached from a server action, which is a public POST
 * endpoint whose TypeScript signature is erased at runtime.
 */
const PATCHABLE = [
  'title',
  'notes',
  'area',
  'kind',
  'unit',
  'start_value',
  'target_value',
  'deadline',
  'metric_source',
  'archived',
] as const

export type GoalPatch = Partial<Record<(typeof PATCHABLE)[number], unknown>>

export async function patchGoal(id: string, patch: GoalPatch): Promise<void> {
  const fields = PATCHABLE.filter((f) => f in patch)
  if (fields.length === 0) return

  const set = fields.map((f, i) => `${f} = $${i + 2}`).join(', ')
  await db().query(`update goals.goal set ${set} where id = $1`, [
    id,
    ...fields.map((f) => patch[f]),
  ])
}

/** A live goal with its arithmetic done, and where it stood a week ago. */
export type MeasuredGoal = {
  row: GoalRow
  progress: Progress
  /** The sentence behind the status. */
  rule: string
  /** Points of progress gained since last week, or null with nothing to compare. */
  movement: number | null
}

/**
 * Every live goal, measured.
 *
 * The Weekly Review shows a goal's percent, its status and the reason for the
 * status, and none of that is the review's arithmetic to do: it is this
 * module's, handed over through the review contract.
 */
export async function measuredGoals(): Promise<MeasuredGoal[]> {
  const [rows, history, todayIso] = await Promise.all([
    listGoals(false),
    historyByGoal(),
    ownerToday(),
  ])

  const days = (fromIso: string, toIso: string) =>
    Math.round(
      (new Date(`${toIso}T12:00:00`).getTime() - new Date(`${fromIso}T12:00:00`).getTime()) /
        86_400_000,
    )

  return rows.map((row) => {
    const shape: Goal = {
      kind: row.kind,
      startValue: Number(row.start_value),
      targetValue: Number(row.target_value),
      deadlineInDays: days(todayIso, row.deadline),
      ageInDays: Math.max(1, days(new Date(row.created_at).toISOString().slice(0, 10), todayIso)),
      history: history.get(row.id) ?? [],
    }

    const now = progress(shape)

    // Where it stood a week ago: the same arithmetic over the history that
    // existed then, so the movement is the goal's rather than the formula's.
    const older = shape.history.filter((p) => p.daysAgo >= 7)
    const then = progress({
      ...shape,
      deadlineInDays: shape.deadlineInDays + 7,
      ageInDays: Math.max(1, shape.ageInDays - 7),
      history: older.map((p) => ({ ...p, daysAgo: p.daysAgo - 7 })),
    })

    return {
      row,
      progress: now,
      rule: rule(shape, now, row.unit),
      movement: older.length > 0 ? Math.round(now.percent - then.percent) : null,
    }
  })
}

export type PendingProposal = { id: string; goal_id: string; tool: string; title: string }

/**
 * What an agent wants to change on a goal and has not been allowed to yet. The
 * proposals table carries no entity column; a goals.write proposal's payload
 * names the id it would patch, which is the truthful match.
 */
export async function pendingProposals(): Promise<PendingProposal[]> {
  const { rows } = await db().query<PendingProposal>(
    `select id, payload->>'id' as goal_id, tool,
            coalesce(reason, payload->>'title', tool) as title
       from core.proposals
      where module = 'goals' and status = 'pending' and payload ? 'id'
      order by created_at desc`,
  )
  return rows
}

export async function deleteGoal(id: string): Promise<void> {
  // The registry row goes and its skill links cascade; check-ins cascade from
  // the goal; events stay, unlinked, with their own title snapshot.
  await db().query(
    `delete from core.entities where module = 'goals' and entity_type = 'goal' and entity_id = $1`,
    [id],
  )
  await db().query(`delete from goals.goal where id = $1`, [id])
}
