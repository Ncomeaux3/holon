import { db } from '@/core/db'

export type TasksDigest = {
  /** Open and dated for today or earlier. */
  dueToday: number
  overdue: number
  /** Minutes of estimated work in today's column. */
  plannedMinutes: number
  completedToday: number
  completedThisWeek: number
  /** Agent-proposed, waiting for approval. */
  awaitingReview: number
  /** Overdue tasks the nightly roll has already moved at least twice. */
  rolledTwice: number
  /** The owner's date the rows below were dated against, YYYY-MM-DD. */
  today: string
  /**
   * Today's work: what is overdue or due today, then what was finished
   * today, then the next dated tasks, six rows in all. The Today page
   * draws these with what sits beside each: project, estimate, review state.
   */
  upcoming: {
    id: string
    title: string
    /** Null only on a task finished today that never had a date. */
    dueOn: string | null
    priority: string
    project: string | null
    estimateMinutes: number | null
    status: string
  }[]
}

type Counts = {
  due_today: string
  overdue: string
  planned_minutes: string
  completed_today: string
  completed_week: string
  awaiting_review: string
}

/**
 * Written to core.digests nightly. Everything outside this module reads these
 * numbers from there, the Dashboard tile included: no other screen reaches into
 * the tasks schema.
 */
export async function nightlyDigest(): Promise<TasksDigest> {
  const { rows } = await db().query<Counts>(
    `select
       count(*) filter (where status = 'open' and due_on = core.today())::text as due_today,
       count(*) filter (where status = 'open' and due_on < core.today())::text as overdue,
       coalesce(sum(estimated_minutes) filter (
         where status = 'open' and due_on <= core.today()), 0)::text as planned_minutes,
       count(*) filter (where status = 'done'
         and completed_at >= core.today())::text as completed_today,
       count(*) filter (where status = 'done'
         and completed_at >= core.today() - 7)::text as completed_week,
       count(*) filter (where status = 'review')::text as awaiting_review
     from tasks.task`,
  )
  const counts = rows[0]
  const rolls = await rollCounts()
  const { rows: overdueIds } = await db().query<{ id: string }>(
    `select id from tasks.task where status = 'open' and due_on < core.today()`,
  )
  const rolledTwice = overdueIds.filter((r) => (rolls.get(r.id) ?? 0) >= 2).length

  const { rows: upcoming } = await db().query<TasksDigest['upcoming'][number]>(
    `select t.id, t.title, t.due_on::text as "dueOn", t.priority, p.name as project,
            t.estimated_minutes as "estimateMinutes", t.status
       from tasks.task t
       left join tasks.project p on p.id = t.project_id
      where (t.status in ('open', 'review') and t.due_on is not null)
         or (t.status = 'done' and t.completed_at >= core.today())
      order by coalesce(t.due_on > core.today(), false), t.status = 'done', t.due_on, t.priority
      limit 6`,
  )
  const { rows: [{ today }] } = await db().query<{ today: string }>(`select core.today()::text as today`)

  return {
    today,
    dueToday: Number(counts.due_today),
    overdue: Number(counts.overdue),
    plannedMinutes: Number(counts.planned_minutes),
    completedToday: Number(counts.completed_today),
    completedThisWeek: Number(counts.completed_week),
    awaitingReview: Number(counts.awaiting_review),
    rolledTwice,
    upcoming,
  }
}

/**
 * How many times the nightly roll has moved each task, read back from the
 * entries rollForward writes to core.write_log. Tasks keeps no counter of its
 * own: the log already has one row per move, with the task id in the payload
 * that would put the move back.
 */
export async function rollCounts(): Promise<Map<string, number>> {
  const { rows } = await db().query<{ id: string; rolls: string }>(
    `select apply_payload->>'id' as id, count(*)::text as rolls
       from core.write_log
      where module = 'tasks' and kind = 'rescheduled' and apply_payload ? 'id'
      group by apply_payload->>'id'`,
  )
  return new Map(rows.map((r) => [r.id, Number(r.rolls)]))
}

/**
 * Anything still open past its due date moves to today, once, overnight.
 *
 * Only work that was never started and has no time of day: a task pinned to
 * 17:30 on Thursday meant that Thursday, and silently moving it would erase
 * the fact that it was missed. Every roll is logged, so the Agent Log can show
 * what moved and put it back.
 */
export async function rollForward(): Promise<{ rolled: number }> {
  const { ownerToday } = await import('@/core/today')
  const today = await ownerToday()

  const { rows } = await db().query<{ id: string; title: string; due_on: string }>(
    `select id, title, due_on::text
       from tasks.task
      where status = 'open' and due_on < core.today() and due_at is null`,
  )
  if (rows.length === 0) return { rolled: 0 }

  const { logWrite } = await import('@/core/writelog')

  for (const task of rows) {
    await db().query(`update tasks.task set due_on = core.today() where id = $1`, [task.id])
    await logWrite({
      module: 'tasks',
      tool: 'write',
      kind: 'rescheduled',
      title: `Rolled "${task.title}" to today`,
      reason: 'It was open past its due date, unstarted, and had no time of day.',
      diff: [{ field: 'due_on', before: task.due_on, after: today }],
      revertPayload: { id: task.id, due_on: task.due_on },
      applyPayload: { id: task.id, due_on: today },
    })
  }

  return { rolled: rows.length }
}
