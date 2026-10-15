import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { NIGHTLY_UTC_HOUR, clockIn, dayIn, minutesIn, nightlyRunAt } from './today'

// The owner's clock, not the server's. On Vercel the server is UTC, and every
// one of these returned the wrong answer before 2026-09-09.

describe('the owner clock', () => {
  // 19:34 on 9 September in Chicago is 00:34 on the 10th in UTC.
  const evening = new Date('2026-09-10T00:34:00Z')

  it('reads the wall clock in the timezone asked for', () => {
    expect(clockIn(evening, 'America/Chicago')).toBe('19:34')
    expect(clockIn(evening, 'UTC')).toBe('00:34')
  })

  it('reads the date in the timezone asked for', () => {
    expect(dayIn(evening, 'America/Chicago')).toBe('9 Sep')
    expect(dayIn(evening, 'UTC')).toBe('10 Sep')
  })

  it('counts minutes since midnight, which is what quiet hours compares', () => {
    expect(minutesIn(evening, 'America/Chicago')).toBe(19 * 60 + 34)
    expect(minutesIn(evening, 'UTC')).toBe(34)
  })

  it('handles midnight without rolling to 24:00', () => {
    const midnight = new Date('2026-09-10T05:00:00Z') // 00:00 in Chicago
    expect(clockIn(midnight, 'America/Chicago')).toBe('00:00')
    expect(minutesIn(midnight, 'America/Chicago')).toBe(0)
  })
})

describe('nightlyRunAt', () => {
  // The question the owner actually asks: what time does this happen to me.
  it('follows daylight saving without an offset table', () => {
    expect(nightlyRunAt('America/Chicago', new Date('2026-01-15T00:00:00Z'))).toBe('03:00')
    expect(nightlyRunAt('America/Chicago', new Date('2026-07-15T00:00:00Z'))).toBe('04:00')
  })

  it('is the cron hour itself in UTC', () => {
    expect(nightlyRunAt('UTC', new Date('2026-07-15T00:00:00Z'))).toBe('09:00')
  })

  // The constant is a copy of what vercel.json schedules. If someone moves the
  // cron and not the constant, the Notifications screen would confidently tell
  // the owner the wrong time, which is worse than saying nothing.
  it('matches the cron schedule in vercel.json', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'))
    const nightly = vercel.crons.find((c: { path: string }) => c.path === '/api/cron/nightly')
    expect(nightly, 'no nightly cron in vercel.json').toBeTruthy()
    const [minute, hour] = String(nightly.schedule).split(' ')
    expect(Number(hour)).toBe(NIGHTLY_UTC_HOUR)
    expect(minute).toBe('0')
  })
})
