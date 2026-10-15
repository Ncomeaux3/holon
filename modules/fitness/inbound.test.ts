import { afterAll, afterEach, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const { db } = await import('@/core/db')
// Through the registry, not './manifest': the workout path calls register(),
// which resolves the classifier through modules/_index, and importing the
// manifest first leaves that half initialised (the cycle core/entities.ts
// documents).
const { getModule } = await import('@/core/modules')

const inbound = getModule('fitness')!.inbound!.health_auto_export

afterEach(async () => {
  await db().query('delete from fitness.body_metric')
  await db().query(`delete from core.events where module = 'fitness' and event_type = 'workout_logged'`)
  await db().query(`delete from core.entities where module = 'fitness' and entity_type = 'workout'`)
  await db().query(`delete from fitness.workout where source in ('health_auto_export', 'apple_shortcuts')`)
})
afterAll(async () => {
  await db().end()
})

const metric = (name: string, units: string, data: Record<string, unknown>[]) => ({
  name,
  units,
  data,
})
const at = (day: string, time = '07:30:00') => `${day} ${time} -0500`

async function rows() {
  const { rows } = await db().query<{ kind: string; measured_on: string; value: string; source: string }>(
    `select kind, to_char(measured_on, 'YYYY-MM-DD') as measured_on, value, source
     from fitness.body_metric order by kind`,
  )
  return rows.map((r) => ({ ...r, value: Number(r.value) }))
}

async function workouts(source = 'health_auto_export') {
  const { rows } = await db().query(
    `select name, kind, to_char(started_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as started_at,
            duration_s, distance_m::float8 as distance_m, avg_hr, detail, source, external_id
       from fitness.workout where source = $1 order by started_at`,
    [source],
  )
  return rows
}

it('translates each metric into the units the table stores', async () => {
  await inbound({
    data: {
      metrics: [
        metric('weight_body_mass', 'lb', [{ qty: 176.4, date: at('2026-09-11') }]),
        metric('resting_heart_rate', 'bpm', [{ qty: 58, date: at('2026-09-11') }]),
        metric('heart_rate_variability', 'ms', [{ qty: 54, date: at('2026-09-11') }]),
        metric('body_fat_percentage', '%', [{ qty: 21.2, date: at('2026-09-11') }]),
        metric('sleep_analysis', 'hr', [
          // The night is the span; the app's summed hours are not read when it is there.
          { totalSleep: 26.7, asleep: 0, sleepStart: at('2026-09-10', '23:00:00'), sleepEnd: at('2026-09-11', '06:30:00') },
        ]),
      ],
    },
  })

  expect(await rows()).toEqual([
    { kind: 'body_fat', measured_on: '2026-09-11', value: 212, source: 'health_auto_export' },
    { kind: 'hrv', measured_on: '2026-09-11', value: 54, source: 'health_auto_export' },
    { kind: 'resting_hr', measured_on: '2026-09-11', value: 58, source: 'health_auto_export' },
    { kind: 'sleep_minutes', measured_on: '2026-09-11', value: 450, source: 'health_auto_export' },
    { kind: 'weight', measured_on: '2026-09-11', value: 80014, source: 'health_auto_export' },
  ])
})

// The manual guard on this table is the source column: log_metric stamps
// 'manual', and a push from the phone must never replace what the owner typed.
it('keeps a manual row and corrects an earlier export on the same day', async () => {
  await db().query(
    `insert into fitness.body_metric (kind, value, measured_on, source) values
       ('weight', 80000, '2026-09-11', 'manual'),
       ('resting_hr', 60, '2026-09-11', 'health_auto_export')`,
  )

  await inbound({
    data: {
      metrics: [
        metric('weight_body_mass', 'kg', [{ qty: 84.5, date: at('2026-09-11') }]),
        metric('resting_heart_rate', 'bpm', [{ qty: 58, date: at('2026-09-11') }]),
      ],
    },
  })

  expect(await rows()).toEqual([
    { kind: 'resting_hr', measured_on: '2026-09-11', value: 58, source: 'health_auto_export' },
    { kind: 'weight', measured_on: '2026-09-11', value: 80000, source: 'manual' },
  ])
})

it('writes nothing for metrics the table has no kind for, unknown weight units, or a v1 workout', async () => {
  await inbound({
    data: {
      metrics: [
        metric('something_new', 'x', [{ qty: 1, date: at('2026-09-11') }]),
        // A weight in units the translation cannot convert is not guessed at.
        metric('weight_body_mass', 'st', [{ qty: 13.2, date: at('2026-09-11') }]),
      ],
      // The legacy shape has no id, so there is nothing to upsert on.
      workouts: [{ name: 'Run', start: at('2026-09-11'), end: at('2026-09-11'), duration: 600 }],
    },
  })

  expect(await rows()).toEqual([])
  expect(await workouts()).toEqual([])
})

// A workout is an entity like a Strava one: upserted on its id so a re-send
// corrects it, registered so it earns Health XP, and registered once.
it('stores a v2 workout, corrects it on a re-send, and registers it once', async () => {
  const run = {
    id: 'hae-1',
    name: 'Outdoor Run',
    start: at('2026-09-11', '06:00:00'),
    end: at('2026-09-11', '06:30:00'),
    duration: 1800,
    distance: { qty: 5, units: 'km' },
    heartRate: { avg: { qty: 150, units: 'bpm' } },
    activeEnergyBurned: { qty: 400, units: 'kcal' },
  }
  await inbound({ data: { workouts: [run] } })
  await inbound({ data: { workouts: [{ ...run, duration: 1860, distance: { qty: 5.2, units: 'km' } }] } })

  expect(await workouts()).toEqual([
    {
      name: 'Outdoor Run',
      kind: 'run',
      started_at: '2026-09-11 11:00',
      duration_s: 1860,
      distance_m: 5200,
      avg_hr: 150,
      detail: '400 kcal',
      source: 'health_auto_export',
      external_id: 'hae-1',
    },
  ])
  const { rows: events } = await db().query<{ n: string }>(
    `select count(*) as n from core.events where module = 'fitness' and event_type = 'workout_logged'`,
  )
  expect(Number(events[0].n)).toBe(1)
})

it('replaces stats on a re-send rather than merging them', async () => {
  const run = {
    id: 'hae-2',
    name: 'Outdoor Run',
    start: at('2026-09-12', '06:00:00'),
    duration: 1800,
    temperature: { qty: 50, units: 'degF' },
    maxHeartRate: { qty: 170, units: 'bpm' },
  }
  await inbound({ data: { workouts: [run] } })
  await inbound({ data: { workouts: [{ ...run, temperature: undefined, humidity: { qty: 60, units: '%' } }] } })

  const { rows } = await db().query(`select stats from fitness.workout where external_id = 'hae-2'`)
  expect(rows[0].stats).toEqual({ maxHr: 170, humidityPct: 60 })
})

it('skips a record with an unreadable date and lands the one beside it', async () => {
  await inbound({
    data: {
      metrics: [
        metric('weight_body_mass', 'kg', [
          { qty: 84, date: '11/09/2026' },
          { qty: 85, date: at('2026-09-12') },
        ]),
      ],
    },
  })

  expect(await rows()).toEqual([
    { kind: 'weight', measured_on: '2026-09-12', value: 85000, source: 'health_auto_export' },
  ])
})

// The Shortcut's flat payload lands through the same write as the app's.
it('takes the Shortcut payload through its own inbound with its own source', async () => {
  await getModule('fitness')!.inbound!.apple_shortcuts({
    day: '2026-09-13',
    metrics: { weight_lb: '176.4', steps: 8135 },
    workouts: [{ name: 'Running', start: '2026-09-13T06:00:00-05:00', minutes: 30, miles: 3.5 }],
  })

  expect(await rows()).toEqual([
    { kind: 'steps', measured_on: '2026-09-13', value: 8135, source: 'apple_shortcuts' },
    { kind: 'weight', measured_on: '2026-09-13', value: 80014, source: 'apple_shortcuts' },
  ])
  expect(await workouts('apple_shortcuts')).toEqual([
    {
      name: 'Running',
      kind: 'run',
      started_at: '2026-09-13 11:00',
      duration_s: 1800,
      distance_m: 5632.7,
      avg_hr: null,
      detail: '',
      source: 'apple_shortcuts',
      external_id: '2026-09-13T06:00:00-05:00',
    },
  ])
})
