import { afterAll, afterEach, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const { db } = await import('@/core/db')
// Through the registry so register() resolves its classifier through a fully
// initialised modules/_index (the cycle core/entities.ts documents).
await import('@/core/modules')
const { store } = await import('./jobs/sync-strava')

afterEach(async () => {
  await db().query(`delete from core.events where module = 'fitness' and event_type = 'workout_logged'`)
  await db().query(`delete from core.entities where module = 'fitness' and entity_type = 'workout'`)
  await db().query(`delete from fitness.workout where source = 'strava'`)
})
afterAll(async () => {
  await db().end()
})

// The sync re-fetches a 48 hour overlap every night, so an activity is stored
// again on two or three runs. It is one workout and earns its XP once.
it('stores an activity, corrects it on the next run, and emits workout_logged once', async () => {
  const activity = {
    id: 987654321,
    name: 'Morning Run',
    sport_type: 'Run',
    start_date: '2026-09-12T11:00:00Z',
    moving_time: 1800.4,
    elapsed_time: 1900,
    distance: 5012.6,
    average_heartrate: 151.2,
  }
  await store(activity)
  await store({ ...activity, name: 'Morning Run (renamed)', moving_time: 1860 })

  const { rows } = await db().query<{ name: string; duration_s: number }>(
    `select name, duration_s from fitness.workout where source = 'strava' and external_id = '987654321'`,
  )
  expect(rows).toEqual([{ name: 'Morning Run (renamed)', duration_s: 1860 }])

  const { rows: events } = await db().query<{ n: string }>(
    `select count(*) as n from core.events where module = 'fitness' and event_type = 'workout_logged'`,
  )
  expect(Number(events[0].n)).toBe(1)
})
