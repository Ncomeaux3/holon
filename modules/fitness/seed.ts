import { db } from '@/core/db'
import { register } from '@/core/entities'
import { toGrams } from './units'

// Synthetic rows for `pnpm setup --demo`. Upserts on external_id so running it
// twice does not duplicate. Nothing here is personal; this ships in the template.
//
// Three weeks of a plausible split, so the load figure has a previous week to
// compare against and the exercise index has repeat sets to find a best in.

type Set = [exercise: string, reps: number, lb: number]

const SESSIONS: {
  daysAgo: number
  name: string
  detail: string
  kind: 'strength' | 'run' | 'walk'
  minutes: number
  metres?: number
  hr?: number
  sets?: Set[]
}[] = [
  { daysAgo: 1, name: 'Lower', detail: 'squat, RDL, leg press', kind: 'strength', minutes: 58,
    sets: [['Squat', 5, 275], ['Squat', 5, 275], ['Romanian deadlift', 8, 205], ['Leg press', 10, 320]] },
  { daysAgo: 3, name: 'Upper', detail: 'bench, rows, pull-ups', kind: 'strength', minutes: 52,
    sets: [['Bench press', 5, 195], ['Bench press', 3, 205], ['Barbell row', 8, 165]] },
  { daysAgo: 4, name: 'Easy run', detail: 'zone 2', kind: 'run', minutes: 50, metres: 5600, hr: 139 },
  { daysAgo: 6, name: 'Lower', detail: 'deadlift day', kind: 'strength', minutes: 61,
    sets: [['Deadlift', 3, 320], ['Deadlift', 1, 335], ['Front squat', 5, 165]] },

  { daysAgo: 8, name: 'Tempo run', detail: 'threshold', kind: 'run', minutes: 46, metres: 7200, hr: 163 },
  { daysAgo: 10, name: 'Upper', detail: 'press, chins', kind: 'strength', minutes: 47,
    sets: [['Overhead press', 5, 115], ['Bench press', 5, 190]] },
  { daysAgo: 11, name: 'Long walk', detail: 'recovery', kind: 'walk', minutes: 58, metres: 4800 },
  { daysAgo: 13, name: 'Lower', detail: 'squat volume', kind: 'strength', minutes: 55,
    sets: [['Squat', 8, 245], ['Romanian deadlift', 8, 185]] },

  { daysAgo: 16, name: 'Easy run', detail: 'zone 2', kind: 'run', minutes: 42, metres: 4800, hr: 141 },
  { daysAgo: 18, name: 'Upper', detail: 'bench focus', kind: 'strength', minutes: 50,
    sets: [['Bench press', 5, 185], ['Barbell row', 8, 155]] },
]

/**
 * A gentle downward drift, because a flat line is the one shape a scale never
 * draws. Newest first, one reading every third day, so fourteen of them reach
 * back 40 days and the Trends tab's 30 day range is not the whole series.
 */
const WEIGHT_LB = [171.6, 171.2, 170.9, 171.3, 170.5, 170.2, 170.6, 169.9, 170.3, 169.6, 170.0, 169.2, 169.5, 169.0]

export async function seed(): Promise<number> {
  for (const [i, session] of SESSIONS.entries()) {
    const { rows } = await db().query<{ id: string }>(
      `insert into fitness.workout
         (name, detail, kind, started_at, duration_s, distance_m, avg_hr, source, external_id)
       values ($1, $2, $3, (core.today() - $4::int)::timestamptz + interval '18 hours',
               $5, $6, $7, 'demo', $8)
       on conflict (source, external_id) do update
         set started_at = excluded.started_at, duration_s = excluded.duration_s
       returning id`,
      [
        session.name,
        session.detail,
        session.kind,
        session.daysAgo,
        session.minutes * 60,
        session.metres ?? 0,
        session.hr ?? null,
        `session-${i}`,
      ],
    )
    const workoutId = rows[0].id

    // Sets have no external id, so they are cleared and rewritten. Nothing
    // outside the workout points at one.
    await db().query(`delete from fitness.set_entry where workout_id = $1`, [workoutId])

    for (const [position, [exercise, reps, lb]] of (session.sets ?? []).entries()) {
      const { rows: ex } = await db().query<{ id: string }>(
        `insert into fitness.exercise (name) values ($1)
         on conflict (name) do update set name = excluded.name
         returning id`,
        [exercise],
      )
      await db().query(
        `insert into fitness.set_entry (workout_id, exercise_id, reps, weight_g, position)
         values ($1, $2, $3, $4, $5)`,
        [workoutId, ex[0].id, reps, toGrams(lb, 'lb'), position],
      )
    }

    // Same path as a real write, so the demo data earns real Health XP rather
    // than sitting inert on the Skill Tree.
    await register({
      module: 'fitness',
      entityType: 'workout',
      entityId: workoutId,
      title: session.name,
      text: session.detail,
      eventType: 'workout_logged',
      replace: true,
      occurredAt: new Date(Date.now() - session.daysAgo * 86_400_000),
    })
  }

  // Same reason as the goals check-ins: these are dated relative to today, so
  // yesterday's rows would sit between today's and change the trend the screen
  // draws. A body metric is not registered in core.entities.
  await db().query(`delete from fitness.body_metric where source = 'demo'`)
  // The source moves with the value: the webhook e2e writes today's weight as
  // health_auto_export, and a demo value left under that label is never deleted
  // above, so one piled up per run day and the Trends count drifted.

  for (const [i, lb] of WEIGHT_LB.entries()) {
    await db().query(
      `insert into fitness.body_metric (kind, value, measured_on, source)
       values ('weight', $1, core.today() - $2::int, 'demo')
       on conflict (kind, measured_on) do update set value = excluded.value, source = excluded.source`,
      [toGrams(lb, 'lb'), i * 3],
    )
  }

  await db().query(
    `insert into fitness.body_metric (kind, value, measured_on, source)
     values ('resting_hr', 57, core.today() - 1, 'demo'),
            ('sleep_minutes', 441, core.today() - 1, 'demo')
     on conflict (kind, measured_on) do update set value = excluded.value, source = excluded.source`,
  )

  // One plan, so the Plan tab and the coach have something to work against.
  // Three days a week is what the seeded weeks actually contain, so the demo
  // does not open with the coach complaining about a missed session.
  const { rows: plans } = await db().query<{ id: string }>(
    `insert into fitness.plan (name, goal, days_per_week, notes, started_on, source, external_id)
     values ('Upper, lower, run', 'Strength through the winter without losing the aerobic base.',
             3, '', core.today() - 60, 'demo', 'plan-winter')
     on conflict (source, external_id) do update
       set days_per_week = excluded.days_per_week, goal = excluded.goal
     returning id`,
  )
  const planId = plans[0].id

  await register({
    module: 'fitness',
    entityType: 'plan',
    entityId: planId,
    title: 'Upper, lower, run',
    text: 'strength winter aerobic base',
    eventType: 'plan_written',
    replace: true,
  })

  // Items are an ordered list owned by the plan, cleared and rewritten rather
  // than diffed. Nothing registers a plan item, so there is nothing to orphan.
  await db().query(`delete from fitness.plan_item where plan_id = $1`, [planId])
  for (const [position, item] of PLAN_ITEMS.entries()) {
    await db().query(
      `insert into fitness.plan_item
         (plan_id, day_label, exercise, sets, reps, target_weight_g, notes, position)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [planId, item[0], item[1], item[2], item[3], item[4], item[5] ?? '', position],
    )
  }

  return SESSIONS.length + PLAN_ITEMS.length
}

/** day, exercise, sets, reps, target grams or null, notes. */
const PLAN_ITEMS: [string, string, number, string, number | null, string?][] = [
  ['Upper', 'Bench press', 4, '5', 80_000, ''],
  ['Upper', 'Barbell row', 4, '8', 66_000, ''],
  ['Upper', 'Overhead press', 3, '8-12', 48_000, 'Stop a rep short of failure.'],
  ['Lower', 'Back squat', 5, '5', 116_000, ''],
  ['Lower', 'Romanian deadlift', 3, '8', 82_000, ''],
  ['Lower', 'Calf raise', 3, 'AMRAP', null, 'Bodyweight is fine.'],
  ['Run', 'Easy run', 1, '40 min', null, 'Conversational pace. If you cannot talk, slow down.'],
]
