import { afterAll, describe, expect, it } from 'vitest'
import { db } from '@/core/db'
import { level, loadWeights } from './xp'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

afterAll(async () => {
  await db().end()
})

describe('level', () => {
  it('matches the documented anchors', () => {
    expect(level(0)).toBe(0)
    expect(level(100)).toBe(1)
    expect(level(2500)).toBe(5)
    expect(level(10_000)).toBe(10)
  })

  it('caps at 99 instead of growing without bound', () => {
    expect(level(980_100)).toBe(99)
    expect(level(10_000_000)).toBe(99)
  })

  it('treats negative xp as zero rather than returning NaN', () => {
    expect(level(-1)).toBe(0)
  })

  // The formula lives twice, once here and once as skills.level() in SQL. This is
  // the test that keeps them honest.
  it('agrees with the SQL function on 20 sample values', async () => {
    const samples = [
      0, 1, 50, 99, 100, 101, 399, 400, 401, 2500, 2501, 9999, 10_000, 40_000, 122_500, 500_000,
      980_099, 980_100, 980_101, 10_000_000,
    ]
    const { rows } = await db().query<{ xp: number; sql_level: number }>(
      `select x as xp, skills.level(x) as sql_level from unnest($1::int[]) as x`,
      [samples],
    )
    expect(rows).toHaveLength(samples.length)
    for (const row of rows) {
      expect(level(row.xp), `xp ${row.xp}`).toBe(row.sql_level)
    }
  })
})

describe('loadWeights', () => {
  it('reads modules/skills/xp.yaml and returns numbers', () => {
    const weights = loadWeights()
    expect(weights.note_created).toBe(2)
    expect(weights.project_shipped).toBe(200)
    expect(typeof weights.task_completed).toBe('number')
  })

  it('has no entry for an unknown event type, so it contributes nothing', () => {
    expect(loadWeights().nothing_like_this).toBeUndefined()
  })
})
