import { db } from '@/core/db'
import { register } from '@/core/entities'
import { type Reminder, toReminders } from '@/integrations/apple_reminders/client'
import { findOrCreateProject } from './data'

// Apple Reminders arriving from the Shortcut, written as tasks.
//
// Apple owns the fields it sends on a row it made: title, notes, due date and
// list. Everything else on the task is POS's and is never touched by a post,
// so a priority, an estimate, a goal or a hand-linked skill survives the sync.
// The traffic is one way: completing a task here does not complete the
// reminder, because there is no Reminders API to complete it through.

/** How long a reminder can be missing from the posts before its task is closed. */
const GONE_DAYS = 2

export async function writeReminders(payload: unknown): Promise<{ written: number; completed: number }> {
  const reminders = toReminders(payload)

  const { rows: known } = await db().query<{ external_id: string }>(
    `select external_id from tasks.task where source = 'apple_reminders' and external_id = any($1::text[])`,
    [reminders.map((r) => r.externalId)],
  )
  const seen = new Set(known.map((r) => r.external_id))

  for (const reminder of reminders) {
    const id = await upsert(reminder)
    // Only a new one: register() emits the creation event, and a reminder
    // posted every hour would otherwise earn its XP every hour.
    if (!seen.has(reminder.externalId)) {
      await register({
        module: 'tasks',
        entityType: 'task',
        entityId: id,
        title: reminder.title,
        text: reminder.notes,
      })
      // A payload that lists one reminder twice is one task, and one event.
      seen.add(reminder.externalId)
    }
  }

  return { written: reminders.length, completed: await sweep() }
}

async function upsert(reminder: Reminder): Promise<string> {
  const projectId = reminder.list ? await findOrCreateProject(reminder.list) : null

  const { rows } = await db().query<{ id: string }>(
    `insert into tasks.task (title, notes, due_on, due_at, project_id, source, external_id, status)
     values ($1, $2, $3, $4, $5, 'apple_reminders', $6, 'open')
     on conflict (source, external_id) do update set
       title = excluded.title,
       -- What Apple sends wins; what it leaves out keeps what is here. A
       -- reminder with no notes, no due date or no list must not wipe the
       -- notes, date or project the owner typed in POS (SPEC: a manual field
       -- is never overwritten). The cost is that clearing a due date in
       -- Apple does not clear it here; clear it here instead.
       notes = case when excluded.notes = '' then tasks.task.notes else excluded.notes end,
       due_on = coalesce(excluded.due_on, tasks.task.due_on),
       due_at = coalesce(excluded.due_at, tasks.task.due_at),
       project_id = coalesce(excluded.project_id, tasks.task.project_id)
     returning id`,
    [reminder.title, reminder.notes, reminder.dueOn, reminder.dueAt, projectId, reminder.externalId],
  )
  return rows[0].id
}

/**
 * A reminder gone from the posts for two days is done in Apple, or deleted.
 * `updated_at` is the last time a post touched the row (the table's trigger
 * writes it on every upsert), so this needs no column of its own. It runs on
 * arrival, so a phone that stops posting closes nothing.
 *
 * A repeating task from Apple is closed here without its next instance being
 * written: Apple's own repeat posts the next reminder, and a POS repeat rule
 * on an Apple row would be two schedules for one task.
 */
async function sweep(): Promise<number> {
  const { rows } = await db().query<{ id: string; title: string }>(
    `update tasks.task
        set status = 'done', completed_at = now()
      where source = 'apple_reminders' and status = 'open'
        and updated_at < now() - ($1 || ' days')::interval
      returning id, title`,
    [GONE_DAYS],
  )

  for (const row of rows) {
    await register({
      module: 'tasks',
      entityType: 'task',
      entityId: row.id,
      title: row.title,
      eventType: 'task_completed',
    })
  }
  return rows.length
}
