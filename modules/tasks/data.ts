import { db } from '@/core/db'
import type { Priority } from './quickadd'
import type { Repeat } from './repeat'

// Reads for the six views, and the two writes behind the tools. Everything the
// screen needs in one place; the shape it renders lives in ./shape.ts, which a
// client component can import.

export type TaskStatus = 'open' | 'review' | 'done'

export type TaskRow = {
  id: string
  title: string
  notes: string
  due_on: string | null
  due_at: string | null
  priority: Priority
  status: TaskStatus
  project_id: string | null
  project_name: string | null
  /** The goal it counts toward: its own, else its project's. */
  goal_ref: string | null
  goal_title: string | null
  own_goal_ref: string | null
  project_goal_ref: string | null
  estimated_minutes: number | null
  remind_minutes: number | null
  repeat: Repeat | null
  source: string
  completed_at: Date | null
  /** Days since it was completed, on the owner's calendar. Null while open. */
  done_days_ago: number | null
}

const SELECT = `
  select t.id, t.title, t.notes, t.due_on::text, t.due_at::text, t.priority, t.status,
         t.project_id, p.name as project_name,
         -- A task counts toward its own goal, else its project's. One
         -- expression here and in listByGoal, so the board and the Goals
         -- drawer cannot disagree.
         coalesce(t.goal_ref, p.goal_ref) as goal_ref, g.title as goal_title,
         t.goal_ref as own_goal_ref, p.goal_ref as project_goal_ref,
         t.estimated_minutes, t.remind_minutes, t.repeat, t.source, t.completed_at,
         -- On the owner's calendar, in the database, because a completion at
         -- 20:00 in Chicago is tomorrow in UTC and was showing as yesterday's.
         case when t.completed_at is null then null
              else core.today() - (t.completed_at at time zone coalesce(
                     (select value #>> '{}' from core.settings where key = 'timezone'), 'UTC'))::date
         end as done_days_ago
    from tasks.task t
    left join tasks.project p on p.id = t.project_id
    -- The goal's title comes from the core registry, so this join works before
    -- the goals module exists and needs no change when it lands.
    left join core.entities g on g.id = coalesce(t.goal_ref, p.goal_ref)`

/**
 * Everything open or in review, plus what was completed in the last week. The
 * Done view only ever shows a week, so there is no reason to read further back
 * and every reason not to.
 */
export async function listTasks(): Promise<TaskRow[]> {
  const { rows } = await db().query<TaskRow>(
    `${SELECT}
      where t.status <> 'done' or t.completed_at >= now() - interval '7 days'
      order by t.due_on nulls last, t.due_at nulls last, t.priority, t.created_at`,
  )
  return rows
}

export async function getTask(id: string): Promise<TaskRow | null> {
  const { rows } = await db().query<TaskRow>(`${SELECT} where t.id = $1`, [id])
  return rows[0] ?? null
}

export type Project = { id: string; name: string; position: number; goal_ref: string | null }

export async function listProjects(): Promise<Project[]> {
  const { rows } = await db().query<Project>(
    `select id, name, position, goal_ref from tasks.project
      where archived = false order by position, name`,
  )
  return rows
}

/** Goals as the core registry knows them. Empty until the goals module ships. */
export async function listGoals(): Promise<{ id: string; title: string }[]> {
  const { rows } = await db().query<{ id: string; title: string }>(
    `select id, title from core.entities
      where module = 'goals' and entity_type = 'goal'
      order by title`,
  )
  return rows
}

/**
 * The tasks on one goal, for the Goals drawer through core's `linked` seam.
 * Days to due are computed on the owner's calendar in the query, so the label
 * matches what the board says.
 */
export async function listByGoal(
  goalRef: string,
): Promise<{ title: string; due_in_days: number | null; done: boolean }[]> {
  const { rows } = await db().query<{ title: string; due_in_days: number | null; done: boolean }>(
    `select t.title, (t.due_on - core.today())::int as due_in_days, t.status = 'done' as done
       from tasks.task t
       left join tasks.project p on p.id = t.project_id
      where coalesce(t.goal_ref, p.goal_ref) = $1
      order by t.status = 'done', t.due_on nulls last, t.priority`,
    [goalRef],
  )
  return rows
}

export async function findOrCreateProject(name: string): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into tasks.project (name) values ($1)
     on conflict (name) do update set name = excluded.name
     returning id`,
    [name],
  )
  return rows[0].id
}

/**
 * The columns a patch is allowed to name.
 *
 * Not the type restated: patchTask builds its SET clause by interpolating
 * column names, and it is reached from a server action, which is a public POST
 * endpoint that accepts whatever it is sent. The signature is erased at
 * runtime, so this list is the only thing standing between a caller and any
 * column on the table.
 */
const PATCHABLE = [
  'title',
  'notes',
  'due_on',
  'due_at',
  'priority',
  'status',
  'project_id',
  'goal_ref',
  'estimated_minutes',
  'remind_minutes',
  'repeat',
] as const

export type TaskPatch = Partial<Record<(typeof PATCHABLE)[number], unknown>>

export async function patchTask(id: string, patch: TaskPatch): Promise<void> {
  const fields = PATCHABLE.filter((f) => f in patch)
  if (fields.length === 0) return

  const set = fields.map((f, i) => `${f} = $${i + 2}`).join(', ')
  await db().query(`update tasks.task set ${set} where id = $1`, [
    id,
    ...fields.map((f) => patch[f]),
  ])
  // The registry row is what the Skill Tree and search name a task by, and
  // register() only runs at creation, so a rename has to reach it here.
  if ('title' in patch) {
    await db().query(
      `update core.entities set title = $2
        where module = 'tasks' and entity_type = 'task' and entity_id = $1`,
      [id, patch.title],
    )
  }
}

/** Same guard as PATCHABLE, for the project table. */
const PROJECT_PATCHABLE = ['name', 'goal_ref', 'archived'] as const

export type ProjectPatch = Partial<Record<(typeof PROJECT_PATCHABLE)[number], unknown>>

export async function patchProject(id: string, patch: ProjectPatch): Promise<void> {
  const fields = PROJECT_PATCHABLE.filter((f) => f in patch)
  if (fields.length === 0) return

  const set = fields.map((f, i) => `${f} = $${i + 2}`).join(', ')
  await db().query(`update tasks.project set ${set} where id = $1`, [
    id,
    ...fields.map((f) => patch[f]),
  ])
}

/** The channels the task reminder rule fires on, or null when it is off. */
export async function reminderChannels(): Promise<string[] | null> {
  const { rows } = await db().query<{ channels: string[]; muted: boolean }>(
    `select channels, muted from core.notification_rules
      where module = 'tasks' and key = 'task_reminder' limit 1`,
  )
  const rule = rows[0]
  return rule && !rule.muted ? rule.channels : null
}

export async function deleteTask(id: string): Promise<void> {
  // The registry row goes with it and its skill links cascade, so the XP a
  // completed task earned goes too. Its events stay, unlinked, with their own
  // title snapshot: the log is append only.
  await db().query(
    `delete from core.entities where module = 'tasks' and entity_type = 'task' and entity_id = $1`,
    [id],
  )
  await db().query(`delete from tasks.task where id = $1`, [id])
}
