import { afterAll, afterEach, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const { db } = await import('@/core/db')
const { default: manifest } = await import('./manifest')
const { lastWeekBest } = await import('./data')

const ui = { source: 'ui' } as const
const NAME = 'Phase8 test press'

async function workout(source: string) {
  const { rows } = await db().query<{ id: string }>(
    `insert into fitness.workout (name, kind, started_at, duration_s, source)
     values ('Phase8 test', 'strength', now() - interval '2 days', 1800, $1) returning id`,
    [source],
  )
  return rows[0].id
}

afterEach(async () => {
  await db().query(`delete from fitness.workout where name = 'Phase8 test'`)
  await db().query(`delete from fitness.exercise where name like 'Phase8 test%'`)
})
afterAll(async () => {
  await db().end()
})

it('write_exercise creates an exercise and edits it by id', async () => {
  const { id } = (await manifest.tools.write_exercise.run(
    { name: NAME, muscle_group: 'Chest', measure: 'weight_reps' },
    ui,
  )) as { id: string }
  await manifest.tools.write_exercise.run({ id, name: `${NAME} 2`, muscle_group: 'Shoulders', measure: 'reps' }, ui)
  const { rows } = await db().query(`select name, muscle_group, measure from fitness.exercise where id = $1`, [id])
  expect(rows[0]).toEqual({ name: `${NAME} 2`, muscle_group: 'Shoulders', measure: 'reps' })
})

it('write_exercise says a rename onto a taken name at the name field', async () => {
  await manifest.tools.write_exercise.run({ name: NAME }, ui)
  const { id } = (await manifest.tools.write_exercise.run({ name: `${NAME} 2` }, ui)) as { id: string }
  await expect(manifest.tools.write_exercise.run({ id, name: NAME }, ui)).rejects.toMatchObject({
    fields: { name: expect.stringMatching(/another exercise has this name/) },
  })
})

it('add_sets appends sets after the ones a hand-logged workout already has', async () => {
  const id = await workout('manual')
  await manifest.tools.add_sets.run({ workout_id: id, sets: [{ exercise: NAME, reps: 5, weight_g: 60000 }] }, ui)
  await manifest.tools.add_sets.run({ workout_id: id, sets: [{ exercise: NAME, reps: 3, weight_g: 70000 }] }, ui)
  const { rows } = await db().query(
    `select reps, weight_g, position from fitness.set_entry where workout_id = $1 order by position`,
    [id],
  )
  expect(rows).toEqual([
    { reps: 5, weight_g: 60000, position: 0 },
    { reps: 3, weight_g: 70000, position: 1 },
  ])
})

it('add_sets refuses a workout Apple sent', async () => {
  const id = await workout('health_auto_export')
  await expect(
    manifest.tools.add_sets.run({ workout_id: id, sets: [{ exercise: NAME, reps: 5, weight_g: 0 }] }, ui),
  ).rejects.toThrow(/logged by hand/)
})

it('lastWeekBest gives the heaviest set per exercise from the last seven days', async () => {
  const id = await workout('manual')
  await manifest.tools.add_sets.run(
    {
      workout_id: id,
      sets: [
        { exercise: NAME, reps: 8, weight_g: 50000 },
        { exercise: NAME, reps: 5, weight_g: 60000 },
      ],
    },
    ui,
  )
  const best = await lastWeekBest()
  expect(best[NAME]).toEqual({ weightG: 60000, reps: 5 })
})

it('distance_this_week reads miles', async () => {
  const before = await manifest.metrics!.distance_this_week.get()
  await db().query(
    `insert into fitness.workout (name, kind, started_at, duration_s, distance_m, source)
     values ('Phase8 test', 'run', now() - interval '1 day', 1800, 3218.69, 'manual')`,
  )
  expect((await manifest.metrics!.distance_this_week.get()) - before).toBeCloseTo(2, 4)
})
