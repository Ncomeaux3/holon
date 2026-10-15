import { z } from 'zod'
import { db } from '@/core/db'
import { ownerToday } from '@/core/today'
import { register } from '@/core/entities'
import { defineModule, defineTool } from '@/core/module-contract'
import { calendarFor } from './calendar'
import { nextAfter, type Repeat } from './repeat'
import { deleteTask, findOrCreateProject, listByGoal, patchProject, patchTask } from './data'
import { writeReminders } from './inbound'
import { nightlyDigest, rollCounts, rollForward } from './jobs/nightly-digest'
import { pullGmail } from './jobs/pull-gmail'
import { dueLabel, hoursLabel, loadLabel, slipMeta } from './shape'
import TasksPage from './ui/TasksPage'
import { TasksTile } from './ui/Tile'

const priority = z.enum(['P1', 'P2', 'P3'])

// A date, not a datetime. "Due Thursday" is a day, and a timestamp makes it
// wrong for anyone who crosses a timezone.
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
const time = z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM')

// Checked here rather than trusted: the rule is walked in a loop by the
// calendar and the complete tool, and a weekday of 9 or a month day of 0
// would be a date that never comes.
const repeat = z
  .object({
    every: z.enum(['day', 'week', 'month', 'year']),
    on: z.array(z.number().int()).max(7).optional(),
    interval: z.number().int().min(1).max(365).optional(),
  })
  .refine(
    ({ every, on = [] }) =>
      every === 'week'
        ? on.every((d) => d >= 0 && d <= 6)
        : every === 'month'
          ? on.length <= 1 && on.every((d) => d === -1 || (d >= 1 && d <= 31))
          : on.length === 0,
    { message: 'Weekdays are 0 to 6; a month day is 1 to 31 or -1 for the last', path: ['on'] },
  )

/**
 * Write the instance after a completed repeating task: same fields, the next
 * due date, the rule carried, its skills copied as automatic links. The
 * unique repeat_from makes this a no-op the second time, so a task completed,
 * reopened and completed again still has one successor. Returns the new id,
 * or null when there is nothing to write.
 */
async function writeNext(id: string): Promise<string | null> {
  const { rows } = await db().query<{
    title: string
    notes: string
    due_on: string | null
    due_at: string | null
    priority: string
    project_id: string | null
    goal_ref: string | null
    estimated_minutes: number | null
    remind_minutes: number | null
    source: string
    repeat: Repeat
  }>(
    `select title, notes, due_on::text, due_at::text, priority, project_id, goal_ref,
            estimated_minutes, remind_minutes, source, repeat
       from tasks.task where id = $1 and repeat is not null`,
    [id],
  )
  const t = rows[0]
  if (!t) return null

  const inserted = await db().query<{ id: string }>(
    `insert into tasks.task
       (title, notes, due_on, due_at, priority, project_id, goal_ref,
        estimated_minutes, remind_minutes, source, status, repeat, repeat_from)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open', $11, $12)
     on conflict (repeat_from) do nothing
     returning id`,
    [
      t.title,
      t.notes,
      nextAfter(t.repeat, t.due_on, await ownerToday()),
      t.due_at,
      t.priority,
      t.project_id,
      t.goal_ref,
      t.estimated_minutes,
      t.remind_minutes,
      t.source,
      t.repeat,
      id,
    ],
  )
  const nextId = inserted.rows[0]?.id
  if (!nextId) return null

  // No creation event: the XP is in completing it, and a monthly task would
  // otherwise earn a creation every month for being written by the tool.
  const entityRef = await register({
    module: 'tasks',
    entityType: 'task',
    entityId: nextId,
    title: t.title,
    text: t.notes,
    emit: false,
  })
  await db().query(
    `insert into core.skill_links (entity_ref, skill_id, weight, confidence, classified_by, is_manual)
     select $1, l.skill_id, l.weight, l.confidence, l.classified_by, false
       from core.skill_links l
       join core.entities e on e.id = l.entity_ref
      where e.module = 'tasks' and e.entity_type = 'task' and e.entity_id = $2
     on conflict (entity_ref, skill_id) do nothing`,
    [entityRef, id],
  )
  return nextId
}

export default defineModule({
  id: 'tasks',
  nav: { label: 'Tasks', icon: 'check', order: 20 },
  pages: { '': TasksPage },

  tools: {
    get_digest: defineTool({
      description: 'Open counts, planned minutes, what was completed, and the next five due.',
      input: z.object({}),
      run: () => nightlyDigest(),
    }),

    write: defineTool({
      description:
        'Create a task, or update one by passing its id. An agent-created task lands in review.',
      input: z.object({
        id: z.uuid().optional(),
        title: z.string().min(1).max(300).optional(),
        notes: z.string().max(10_000).optional(),
        due_on: date.nullable().optional(),
        due_at: time.nullable().optional(),
        priority: priority.optional(),
        project: z.string().max(80).nullable().optional(),
        goal_ref: z.uuid().nullable().optional(),
        estimated_minutes: z.number().int().min(0).max(10_000).nullable().optional(),
        remind_minutes: z.number().int().min(0).max(20_160).nullable().optional(),
        repeat: repeat.nullable().optional(),
      }),
      run: async (input, ctx) => {
        const projectId =
          input.project === undefined
            ? undefined
            : input.project === null
              ? null
              : await findOrCreateProject(input.project)

        if (input.id) {
          await patchTask(input.id, {
            ...(input.title !== undefined && { title: input.title }),
            ...(input.notes !== undefined && { notes: input.notes }),
            ...(input.due_on !== undefined && { due_on: input.due_on }),
            ...(input.due_at !== undefined && { due_at: input.due_at }),
            ...(input.priority !== undefined && { priority: input.priority }),
            ...(projectId !== undefined && { project_id: projectId }),
            ...(input.goal_ref !== undefined && { goal_ref: input.goal_ref }),
            ...(input.estimated_minutes !== undefined && {
              estimated_minutes: input.estimated_minutes,
            }),
            ...(input.remind_minutes !== undefined && { remind_minutes: input.remind_minutes }),
            ...(input.repeat !== undefined && { repeat: input.repeat }),
          })

          // No register() on an update. It emits the creation event, and a task
          // edited twice would award its XP twice.
          return { id: input.id }
        }

        if (!input.title) throw new Error('A new task needs a title')

        // An agent-created task is a real row that does not count as work until
        // the owner approves it. That is what the Review view is.
        const status = ctx.source === 'agent' ? 'review' : 'open'

        const { rows } = await db().query<{ id: string }>(
          `insert into tasks.task
             (title, notes, due_on, due_at, priority, project_id, goal_ref,
              estimated_minutes, remind_minutes, source, status, repeat)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           returning id`,
          [
            input.title,
            input.notes ?? '',
            input.due_on ?? null,
            input.due_at ?? null,
            input.priority ?? 'P2',
            projectId ?? null,
            input.goal_ref ?? null,
            input.estimated_minutes ?? null,
            input.remind_minutes ?? null,
            ctx.source === 'agent' ? 'agent' : 'manual',
            status,
            input.repeat ?? null,
          ],
        )

        await register({
          module: 'tasks',
          entityType: 'task',
          entityId: rows[0].id,
          title: input.title,
          text: input.notes,
        })

        return { id: rows[0].id, status }
      },
    }),

    write_project: defineTool({
      description:
        'Create a project, or update one by passing its id: rename it, point it at a goal, or archive it. Its tasks count toward the goal unless they name their own.',
      input: z.object({
        id: z.uuid().optional(),
        name: z.string().min(1).max(80).optional(),
        goal_ref: z.uuid().nullable().optional(),
        archived: z.boolean().optional(),
      }),
      run: async (input) => {
        if (!input.id && !input.name) throw new Error('A new project needs a name')
        const id = input.id ?? (await findOrCreateProject(input.name!))
        await patchProject(id, {
          ...(input.id && input.name !== undefined && { name: input.name }),
          ...(input.goal_ref !== undefined && { goal_ref: input.goal_ref }),
          // A new project by an archived name comes back rather than staying
          // hidden behind the upsert.
          ...(input.archived !== undefined
            ? { archived: input.archived }
            : !input.id && { archived: false }),
        })
        return { id }
      },
    }),

    complete: defineTool({
      description:
        'Mark a task done, or reopen it. Completing emits the event that earns XP, and completing a repeating task writes its next instance.',
      input: z.object({ id: z.uuid(), done: z.boolean().default(true) }),
      run: async ({ id, done }) => {
        const { rows } = await db().query<{ title: string; status: string }>(
          `update tasks.task
              set status = case when $2 then 'done' else 'open' end,
                  completed_at = case when $2 then now() else null end
            where id = $1
            returning title, status`,
          [id, done],
        )
        if (rows.length === 0) throw new Error(`No task ${id}`)

        // Completion is a thing that happens, and it can happen again on the
        // same row, so the event type is explicit rather than the default
        // creation event register() would emit.
        if (done) {
          await register({
            module: 'tasks',
            entityType: 'task',
            entityId: id,
            title: rows[0].title,
            eventType: 'task_completed',
          })
          const next = await writeNext(id)
          return { id, status: rows[0].status, next }
        }

        return { id, status: rows[0].status }
      },
    }),

    review_task: defineTool({
      description:
        'The weekly review as a repeating task (Weekly review settings). set writes or moves the one open instance to the review day, off deletes it (done ones stay), find returns its id.',
      input: z.object({
        action: z.enum(['set', 'off', 'find']),
        day: z.number().int().min(0).max(6).optional(),
        due_on: date.optional(),
      }),
      run: async ({ action, day, due_on }) => {
        // The root carries external_id 'weekly_review'; later instances are
        // reached through repeat_from, because writeNext copies no external_id
        // (the done root still holds it under unique (source, external_id)).
        // ponytail: deleting a done instance by hand sets its successor's
        // repeat_from null and breaks the chain; the next set then starts a
        // second open task. Match on title as well if that ever happens.
        const { rows } = await db().query<{ id: string; due_on: string | null }>(
          `with recursive chain as (
             select id, status, due_on from tasks.task
              where source = 'manual' and external_id = 'weekly_review'
             union all
             select t.id, t.status, t.due_on from tasks.task t join chain c on t.repeat_from = c.id
           )
           select id, due_on::text from chain where status <> 'done' limit 1`,
        )
        const open = rows[0]?.id ?? null
        if (action === 'find') return { id: open, due_on: rows[0]?.due_on ?? null }
        if (action === 'off') {
          if (open) await deleteTask(open)
          return { id: null }
        }

        if (day === undefined || !due_on) throw new Error('set needs a day and a due date')
        const rule = { every: 'week', on: [day] }
        if (open) {
          await db().query(`update tasks.task set due_on = $2, repeat = $3 where id = $1`, [open, due_on, rule])
          return { id: open }
        }

        // A new chain: the old root (done, or deleted with its chain) gives up
        // the key so the unique constraint takes the new one.
        await db().query(
          `update tasks.task set external_id = null where source = 'manual' and external_id = 'weekly_review'`,
        )
        const inserted = await db().query<{ id: string }>(
          `insert into tasks.task (title, due_on, source, external_id, status, repeat)
           values ('Weekly review', $1, 'manual', 'weekly_review', 'open', $2)
           returning id`,
          [due_on, rule],
        )
        const id = inserted.rows[0].id
        await register({ module: 'tasks', entityType: 'task', entityId: id, title: 'Weekly review' })
        return { id }
      },
    }),

    approve: defineTool({
      description: 'Accept an agent-proposed task, moving it from review into the working list.',
      input: z.object({ id: z.uuid() }),
      run: async ({ id }) => {
        await db().query(`update tasks.task set status = 'open' where id = $1 and status = 'review'`, [
          id,
        ])
        return { id }
      },
    }),

    delete: defineTool({
      description: 'Delete a task and its registry row. Its skill links go with it; its events stay.',
      input: z.object({ id: z.uuid() }),
      run: async ({ id }) => {
        await deleteTask(id)
        return { id }
      },
    }),
  },

  // Delete is the one thing here an agent should propose rather than do. An
  // agent-created task already lands in review, which is this module's own
  // version of the same guard, and guarding write as well would put it behind
  // two approvals.
  // What Goals lists under a goal: its tasks, as the board labels them.
  linked: async (entityRef) => {
    const [rows, todayIso] = await Promise.all([listByGoal(entityRef), ownerToday()])
    const today = new Date(`${todayIso}T12:00:00`)
    return rows.map((r) => ({
      title: r.title,
      meta: r.done ? 'done' : dueLabel(r.due_in_days, today),
      done: r.done,
      href: '/tasks?view=goal',
    }))
  },

  guarded: ['delete', 'review_task'],
  requires: [],
  calendar: calendarFor,

  // What a goal can point at. Goals never queries the tasks schema; it stores
  // the key and asks the registry for the number.
  metrics: {
    completed_this_week: {
      label: 'Tasks completed this week',
      unit: 'tasks',
      get: async () => {
        const { rows } = await db().query<{ n: string }>(
          `select count(*)::text as n from tasks.task
            where status = 'done' and completed_at >= core.today() - 7`,
        )
        return Number(rows[0].n)
      },
    },
    open_count: {
      label: 'Open tasks',
      unit: 'tasks',
      get: async () => {
        const { rows } = await db().query<{ n: string }>(
          `select count(*)::text as n from tasks.task where status = 'open'`,
        )
        return Number(rows[0].n)
      },
    },
  },

  // What Tasks contributes to the Weekly Review. Core composes this without
  // reading the tasks schema, and a fork that deletes this folder gets a
  // review with no misses step rather than a broken one.
  review: {
    // What closed this week, grouped by the project it belonged to. Grouped
    // rather than listed one by one: eleven ticked boxes is a list, "six tasks
    // on POS v1" is a week. The biggest group is marked as such.
    wins: async () => {
      const { rows } = await db().query<{
        project: string | null
        done: string
        minutes: string | null
      }>(
        `select p.name as project, count(*)::text as done,
                sum(t.estimated_minutes)::text as minutes
           from tasks.task t
           left join tasks.project p on p.id = t.project_id
          where t.status = 'done'
            and t.completed_at >= core.today() - interval '7 days'
          group by p.name
          order by count(*) desc
          limit 5`,
      )

      return rows.map((r, i) => {
        const done = Number(r.done)
        const spent = loadLabel(Number(r.minutes ?? 0))

        return {
          id: `tasks-${r.project ?? 'none'}`,
          title: `${done} task${done === 1 ? '' : 's'} closed${r.project ? ` on ${r.project}` : ''}`,
          meta: `Tasks${r.project ? '' : ' · no project'}${spent ? ` · ${spent}` : ''}`,
          // Only when it is actually the biggest. Two groups of one are not a
          // ranking, and marking either would be a claim the data does not
          // support.
          tag: i === 0 && done > Number(rows[1]?.done ?? 0) ? 'biggest' : undefined,
        }
      })
    },

    slipped: async () => {
      const { rows } = await db().query<{
        id: string
        title: string
        due_on: string
        project: string | null
        est: number | null
      }>(
        `select t.id, t.title, t.due_on::text, p.name as project, t.estimated_minutes as est
           from tasks.task t
           left join tasks.project p on p.id = t.project_id
          where t.status = 'open' and t.due_on < core.today()
          order by t.due_on
          limit 12`,
      )
      // How often each one has rolled comes from this module's own entries in
      // the write log, not from a counter; see rollCounts.
      const [rolls, today] = await Promise.all([rollCounts(), ownerToday()])
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        meta: slipMeta({ dueOn: r.due_on, today, rolls: rolls.get(r.id) ?? 0, project: r.project }),
        estimateMinutes: r.est,
      }))
    },

    upcoming: async () => {
      const { rows } = await db().query<{
        id: string
        title: string
        project: string | null
        est: number | null
        due_on: string | null
      }>(
        `select t.id, t.title, p.name as project, t.estimated_minutes as est,
                t.due_on::text
           from tasks.task t
           left join tasks.project p on p.id = t.project_id
          where t.status = 'open' and (t.due_on is null or t.due_on >= core.today())
          order by t.priority, t.due_on nulls last
          limit 12`,
      )
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        meta: r.project ?? 'No project',
        estimateMinutes: r.est,
        at: r.due_on,
        href: `/tasks?task=${r.id}`,
      }))
    },

    apply: async ({ carry, carryTo, drop }) => {
      // Carrying moves the date. Dropping closes it: the owner decided it is
      // not happening, and leaving it open would put it back in next week's
      // misses forever.
      if (carry.length > 0) {
        await db().query(
          `update tasks.task set due_on = $2::date where id = any($1) and status = 'open'`,
          [carry, carryTo],
        )
      }
      if (drop.length > 0) {
        const { rows } = await db().query<{ id: string }>(
          `update tasks.task set status = 'done', completed_at = now()
            where id = any($1) and status = 'open'
            returning id`,
          [drop],
        )
        // Dropping skips this instance, not the series.
        for (const { id } of rows) await writeNext(id)
      }
    },
  },

  /** See ModuleManifest.tile: the module says how its own numbers read. */
  tile: TasksTile,
  // "Today" over "0 of 4 done, about 2 h": the count and the planned time
  // beside the section's heading.
  tileHead: (payload) => {
    const n = (key: string) => (typeof payload[key] === 'number' ? (payload[key] as number) : 0)
    const planned = n('plannedMinutes')
    return {
      label: 'Today',
      meta:
        `${n('completedToday')} of ${n('dueToday') + n('completedToday')} done` +
        (planned > 0 ? `, about ${hoursLabel(planned)}` : ''),
    }
  },

  // Gmail before the digest, so the Review count it reads includes tonight's mail.
  jobs: [
    { name: 'pull_gmail', run: pullGmail },
    { name: 'roll_forward', run: rollForward },
    { name: 'nightly_digest', run: nightlyDigest },
  ],

  inbound: {
    // Open reminders posted by the iOS Shortcut. Not in `requires`: Tasks is
    // usable, and complete, without a phone posting anything.
    apple_reminders: async (payload) => {
      await writeReminders(payload)
    },
  },
  entityHref: (t, id) => (t === 'task' ? `/tasks?task=${id}` : null),
  entityTypes: ['task'],
})
