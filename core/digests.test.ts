import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { pruneDigests } from './digests'

// Every write tool leaves a digest row (core/tools.ts), so the table grows all
// day. The prune keeps the recent past whole and thins the rest to one row per
// module per day, which is what digestsBefore(7) needs to still find last week.

// Anchored to noon of the target day, not to now(): relative to now() the
// rows straddle a day boundary every evening (CDT is UTC minus five).
async function insert(module: string, daysAgo: number, hour: number) {
  await db().query(
    `insert into core.digests (module, run_at, payload)
     values ($1, (now()::date - $2::int)::timestamptz + make_interval(hours => 12 + $3), '{}'::jsonb)`,
    [module, daysAgo, hour],
  )
}

async function count(module: string): Promise<number> {
  const { rows } = await db().query<{ n: string }>(
    'select count(*)::text as n from core.digests where module = $1',
    [module],
  )
  return Number(rows[0].n)
}

beforeEach(async () => {
  await db().query(`delete from core.digests where module like 'prune_test_%'`)
})

describe('pruneDigests', () => {
  it('keeps every row from the last two days', async () => {
    await insert('prune_test_a', 0, -3)
    await insert('prune_test_a', 0, -2)
    await insert('prune_test_a', 1, -3)
    await insert('prune_test_a', 1, -1)

    await pruneDigests()

    expect(await count('prune_test_a')).toBe(4)
  })

  it('keeps only the newest row per module per day past two days', async () => {
    // Three rows on one day last week, two on another.
    await insert('prune_test_b', 7, -1)
    await insert('prune_test_b', 7, -2)
    await insert('prune_test_b', 7, -3)
    await insert('prune_test_b', 9, -1)
    await insert('prune_test_b', 9, -2)

    const { deleted } = await pruneDigests()

    expect(deleted).toBe(3)
    expect(await count('prune_test_b')).toBe(2)
    const { rows } = await db().query<{ run_at: Date }>(
      `select run_at from core.digests where module = 'prune_test_b' order by run_at desc`,
    )
    // The survivor of each day is that day's newest: 11:00, not 09:00 or 10:00.
    expect(rows[0].run_at.getUTCHours()).toBe(11)
  })
})
