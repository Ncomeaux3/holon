import { afterAll, afterEach, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const { db } = await import('@/core/db')
const { checkIn } = await import('./data')

afterEach(async () => {
  await db().query('delete from goals.checkin')
  await db().query('delete from goals.goal')
})
afterAll(async () => {
  await db().end()
})

async function aGoal(): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into goals.goal (title, target_value, unit, deadline, source, external_id)
     values ('Deadlift 385', 385, 'lb', core.today() + 30, 'demo', 'g1') returning id`,
  )
  return rows[0].id
}

// The rule from CLAUDE.md: "Manual override always wins. Never overwrite a row
// where is_manual = true." The nightly pullMetrics job writes with
// isManual: false onto whatever occurred_on it is run for, which is the same
// day the owner may already have typed a number by hand.
it('a nightly metric pull does not overwrite a hand entered value', async () => {
  const goalId = await aGoal()

  await checkIn({ goalId, value: 200, note: 'measured at the gym', isManual: true })
  await checkIn({ goalId, value: 175, note: '', isManual: false })

  const { rows } = await db().query<{ value: string; note: string; is_manual: boolean }>(
    `select value, note, is_manual from goals.checkin where goal_id = $1`,
    [goalId],
  )

  expect(rows).toHaveLength(1)
  expect(rows[0].is_manual).toBe(true)
  expect(Number(rows[0].value)).toBe(200)
  expect(rows[0].note).toBe('measured at the gym')
})
