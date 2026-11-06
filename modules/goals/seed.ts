import { db } from '@/core/db'
import { register } from '@/core/entities'

// Synthetic rows for `pnpm setup --demo`. Upserts on external_id so running it
// twice does not duplicate. Nothing here is personal; this ships in the template.
//
// The check-in histories are shaped so every status rule is visible on the
// screen: one on track, one at risk, one stalled, one done, one habit, one
// milestone. A demo where everything is green does not show what the screen is
// for.

type Demo = {
  external_id: string
  title: string
  notes?: string
  area: string
  kind: 'number' | 'count' | 'streak' | 'milestone'
  unit: string
  start: number
  target: number
  /** Days from today. */
  deadlineInDays: number
  ageInDays: number
  metric?: string
  archived?: boolean
  /** [days ago, value], oldest first. */
  history: [number, number][]
}

const GOALS: Demo[] = [
  {
    external_id: 'demo-1',
    title: 'Net worth $260k',
    notes: 'Brokerage plus retirement plus cash, minus the card. Snapshot nightly.',
    area: 'Life ops',
    kind: 'number',
    unit: '$',
    start: 180_000,
    target: 260_000,
    deadlineInDays: 470,
    ageInDays: 240,
    history: [
      [240, 180_000], [210, 183_100], [180, 188_200], [150, 193_000], [120, 197_300],
      [90, 203_100], [60, 208_000], [30, 213_250], [0, 216_384],
    ],
  },
  {
    external_id: 'demo-2',
    title: 'Deadlift 385',
    notes: 'Top set of the day. Five pounds every two weeks is the plan.',
    area: 'Health',
    kind: 'number',
    unit: 'lb',
    start: 255,
    target: 385,
    deadlineInDays: 84,
    ageInDays: 180,
    // Flat for forty days: stalled.
    history: [[180, 255], [150, 265], [120, 275], [90, 290], [60, 300], [40, 320], [0, 320]],
  },
  {
    external_id: 'demo-3',
    title: 'Finish 12 books this year',
    area: 'Communication',
    kind: 'count',
    unit: 'books',
    start: 0,
    target: 12,
    deadlineInDays: 114,
    ageInDays: 249,
    // Behind the pace it needs: at risk.
    history: [[249, 0], [190, 2], [130, 4], [60, 6], [25, 7], [0, 7]],
  },
  {
    external_id: 'demo-4',
    title: 'Ship Holon Phase 1',
    notes: 'Sixteen steps in the phase plan.',
    area: 'Engineering',
    kind: 'count',
    unit: 'steps',
    start: 0,
    target: 16,
    deadlineInDays: 21,
    ageInDays: 60,
    history: [[60, 0], [40, 4], [20, 8], [12, 11], [5, 13], [0, 15]],
  },
  {
    external_id: 'demo-5',
    title: 'Cook at home 5 nights a week',
    area: 'Health',
    kind: 'streak',
    unit: '/wk',
    start: 0,
    target: 5,
    deadlineInDays: 90,
    ageInDays: 35,
    history: [[35, 2], [21, 3], [14, 4], [7, 3], [0, 3]],
  },
  {
    external_id: 'demo-6',
    title: 'Run a half marathon',
    notes: 'Registered for the spring race. The training plan starts in January.',
    area: 'Health',
    kind: 'milestone',
    unit: '',
    start: 0,
    target: 1,
    deadlineInDays: 240,
    ageInDays: 20,
    history: [[20, 0], [0, 0]],
  },
  {
    external_id: 'demo-7',
    title: 'Clear the task backlog every week',
    area: 'Engineering',
    kind: 'count',
    unit: 'tasks',
    start: 0,
    target: 10,
    deadlineInDays: 60,
    ageInDays: 30,
    // The one pointed at a live metric, so the nightly job has something to do
    // and the "computed" chip is not hypothetical.
    metric: 'tasks.completed_this_week',
    history: [[30, 0], [14, 1], [0, 2]],
  },
  {
    external_id: 'demo-8',
    title: 'Emergency fund $15k',
    area: 'Life ops',
    kind: 'number',
    unit: '$',
    start: 4_000,
    target: 15_000,
    deadlineInDays: -60,
    ageInDays: 400,
    archived: true,
    history: [[400, 4_000], [200, 11_000], [70, 15_200]],
  },
]

export async function seed(): Promise<number> {
  for (const goal of GOALS) {
    const { rows } = await db().query<{ id: string }>(
      `insert into goals.goal
         (title, notes, area, kind, unit, start_value, target_value, deadline,
          metric_source, archived, source, external_id, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, core.today() + $8::int, $9, $10, 'demo', $11,
               now() - ($12::int || ' days')::interval)
       on conflict (source, external_id) do update
         set title = excluded.title, notes = excluded.notes, area = excluded.area,
             target_value = excluded.target_value, deadline = excluded.deadline,
             metric_source = excluded.metric_source, archived = excluded.archived
       returning id`,
      [
        goal.title,
        goal.notes ?? '',
        goal.area,
        goal.kind,
        goal.unit,
        goal.start,
        goal.target,
        goal.deadlineInDays,
        goal.metric ?? null,
        goal.archived ?? false,
        goal.external_id,
        goal.ageInDays,
      ],
    )
    const id = rows[0].id

    // Cleared and rewritten, not upserted on the date. The history is relative
    // to today, so yesterday's rows sit one day further back than the ones
    // written now and the extra point moves what the screen computes: a goal
    // flat for forty days reads as forty one the next morning. A check-in is
    // not registered in core.entities, so there is nothing to orphan.
    await db().query(`delete from goals.checkin where goal_id = $1 and source = 'demo'`, [id])

    for (const [daysAgo, value] of goal.history) {
      await db().query(
        `insert into goals.checkin (goal_id, value, occurred_on, is_manual, source)
         values ($1, $2, core.today() - $3::int, true, 'demo')`,
        [id, value, daysAgo],
      )
    }

    // Same path as a real write, so the demo data exercises classification and
    // the event log rather than sitting inert.
    await register({
      module: 'goals',
      entityType: 'goal',
      entityId: id,
      title: goal.title,
      text: goal.notes,
    })
  }

  return GOALS.length
}
