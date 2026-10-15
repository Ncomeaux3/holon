import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { DEFAULT_SETTINGS, getSetting, getSettings, setSetting } from './settings'

// Runs against the local Supabase stack, like core/db.test.ts.
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

afterEach(async () => {
  await db().query('delete from core.settings')
})
afterAll(async () => {
  await db().end()
})

describe('getSetting', () => {
  it('returns the default when no row exists', async () => {
    await expect(getSetting('timezone')).resolves.toBe(DEFAULT_SETTINGS.timezone)
    await expect(getSetting('digest_hour')).resolves.toBe(DEFAULT_SETTINGS.digest_hour)
  })

  it('returns the stored value once one is set', async () => {
    await setSetting('timezone', 'Europe/Madrid')
    await expect(getSetting('timezone')).resolves.toBe('Europe/Madrid')
  })

  it('keeps numbers as numbers rather than jsonb strings', async () => {
    await setSetting('digest_hour', 6)
    const hour = await getSetting('digest_hour')
    expect(hour).toBe(6)
    expect(typeof hour).toBe('number')
  })

  it('overwrites rather than duplicating on a second write', async () => {
    await setSetting('owner_name', 'First')
    await setSetting('owner_name', 'Second')
    await expect(getSetting('owner_name')).resolves.toBe('Second')
    const { rows } = await db().query(`select count(*)::int as n from core.settings`)
    expect(rows[0].n).toBe(1)
  })
})

describe('getSettings', () => {
  it('fills every key, mixing stored values with defaults', async () => {
    await setSetting('owner_name', 'Nick')
    await expect(getSettings()).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      owner_name: 'Nick',
    })
  })
})
