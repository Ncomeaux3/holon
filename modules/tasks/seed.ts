import { db } from '@/core/db'
import { register } from '@/core/entities'

// Synthetic rows for `pnpm setup --demo`. Upserts on external_id so running it
// twice does not duplicate. Nothing here is personal; this ships in the template.

const PROJECTS = ['POS', 'Home', 'Health', 'Career', 'Finance', 'Learning']

/**
 * Due dates are offsets from today, not fixed dates, so the board looks the
 * same whenever the demo is seeded rather than filling up with overdue work
 * a month after the template was cloned.
 */
const TASKS: {
  external_id: string
  title: string
  notes?: string
  dueInDays: number | null
  at?: string
  priority: 'P1' | 'P2' | 'P3'
  project: string
  estimate?: number
  remind?: number
  source?: 'manual' | 'agent'
  status?: 'open' | 'review' | 'done'
  doneDaysAgo?: number
}[] = [
  { external_id: 'demo-1', title: 'Recurring detection tests', notes: 'Same merchant, amount within 10 percent, weekly or monthly or yearly cadence.', dueInDays: -1, priority: 'P1', project: 'POS', estimate: 90 },
  { external_id: 'demo-2', title: 'Read DDIA ch. 5, Replication', dueInDays: 0, priority: 'P2', project: 'Learning', estimate: 40 },
  // demo-2b exists so the swipe to complete gesture has a task of its own. It
  // shared demo-2 with the click to complete test, which runs in the desktop
  // project against the same database, so whichever landed first left the
  // other looking at a task that was already done.
  { external_id: 'demo-2b', title: 'Sketch the week ahead', dueInDays: 0, priority: 'P3', project: 'Learning', estimate: 15 },
  { external_id: 'demo-3', title: 'Lower, deadlift day', dueInDays: 0, at: '17:30', priority: 'P2', project: 'Health', estimate: 60, remind: 30 },
  { external_id: 'demo-4', title: 'Pay the card statement', dueInDays: 1, at: '09:00', priority: 'P1', project: 'Finance', estimate: 5 },
  { external_id: 'demo-5', title: 'Renew the renters policy', notes: 'Quote saved. Compare against one more carrier.', dueInDays: 3, priority: 'P2', project: 'Home', estimate: 30 },
  { external_id: 'demo-6', title: 'Ship the Search page and the palette', dueInDays: 4, priority: 'P1', project: 'POS', estimate: 180 },
  { external_id: 'demo-7', title: 'Update the resume with the POS project', dueInDays: 5, priority: 'P3', project: 'Career', estimate: 45 },
  { external_id: 'demo-8', title: 'Meal prep for the week', dueInDays: 6, priority: 'P3', project: 'Health', estimate: 120 },
  { external_id: 'demo-9', title: 'Fix the garage door sensor', dueInDays: 12, priority: 'P3', project: 'Home', estimate: 30 },
  { external_id: 'demo-10', title: 'Rebalance the index funds', dueInDays: 30, priority: 'P2', project: 'Finance', estimate: 30 },
  { external_id: 'demo-11', title: 'Write the post: one module at a time', dueInDays: null, priority: 'P3', project: 'Career', estimate: 90 },
  // Overdue and pinned to a time, which roll_forward deliberately leaves
  // alone: a task set for 09:00 on Friday meant that Friday, and moving it
  // would erase the fact that it was missed. It is also what guarantees the
  // weekly review always has something to decide about.
  { external_id: 'demo-16', title: 'Call the carrier about the umbrella policy', notes: 'Quote reference is on the Insurance page.', dueInDays: -2, at: '09:00', priority: 'P2', project: 'Home', estimate: 15 },

  // Agent proposed, so the Review view has something in it.
  { external_id: 'demo-12', title: 'Test the bank sync against three months of history', notes: 'Cadence detection needs at least three monthly cycles.', dueInDays: 2, priority: 'P1', project: 'POS', estimate: 60, source: 'agent', status: 'review' },
  { external_id: 'demo-13', title: 'Book the rental car', notes: 'The trip has flights but no ground transport.', dueInDays: 8, priority: 'P2', project: 'Home', estimate: 20, source: 'agent', status: 'review' },

  // Done, so the Done view has both of its columns.
  { external_id: 'demo-14', title: 'Sidebar collapse and the theme toggle', dueInDays: -2, priority: 'P2', project: 'POS', estimate: 60, status: 'done', doneDaysAgo: 0 },
  { external_id: 'demo-15', title: 'Upper, bench day', dueInDays: -1, priority: 'P2', project: 'Health', estimate: 55, status: 'done', doneDaysAgo: 2 },
]

export async function seed(): Promise<number> {
  const projects = new Map<string, string>()
  for (const [i, name] of PROJECTS.entries()) {
    const { rows } = await db().query<{ id: string }>(
      `insert into tasks.project (name, position, source, external_id)
       values ($1, $2, 'demo', $1)
       on conflict (name) do update set position = excluded.position
       returning id`,
      [name, i],
    )
    projects.set(name, rows[0].id)
  }

  for (const task of TASKS) {
    const status = task.status ?? 'open'

    const { rows } = await db().query<{ id: string }>(
      `insert into tasks.task
         (title, notes, due_on, due_at, priority, project_id, estimated_minutes,
          source, external_id, status, completed_at, remind_minutes)
       values ($1, $2,
               case when $3::int is null then null else core.today() + $3::int end,
               $4, $5, $6, $7, $8, $9, $10,
               case when $11::int is null then null else now() - ($11::int || ' days')::interval end,
               $12)
       on conflict (source, external_id) do update
         set title = excluded.title, notes = excluded.notes, due_on = excluded.due_on,
             priority = excluded.priority, status = excluded.status,
             completed_at = excluded.completed_at, remind_minutes = excluded.remind_minutes
       returning id`,
      [
        task.title,
        task.notes ?? '',
        task.dueInDays,
        task.at ?? null,
        task.priority,
        projects.get(task.project) ?? null,
        task.estimate ?? null,
        task.source ?? 'demo',
        task.external_id,
        status,
        status === 'done' ? (task.doneDaysAgo ?? 0) : null,
        task.remind ?? null,
      ],
    )

    // Same path as a real write, so the demo data exercises classification and
    // the event log rather than sitting inert.
    await register({
      module: 'tasks',
      entityType: 'task',
      entityId: rows[0].id,
      title: task.title,
      text: task.notes,
    })

    // A completed demo task has to have earned its XP, or the Skill Tree shows
    // a week of work with nothing behind it.
    if (status === 'done') {
      await register({
        module: 'tasks',
        entityType: 'task',
        entityId: rows[0].id,
        title: task.title,
        eventType: 'task_completed',
        replace: true,
        occurredAt: new Date(Date.now() - (task.doneDaysAgo ?? 0) * 86_400_000),
      })
    }
  }

  return TASKS.length
}
