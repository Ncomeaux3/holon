import { cache } from 'react'
import { clockIn } from './clock'
import { db } from './db'

/**
 * The owner's date, as the database computes it.
 *
 * Not `new Date()` in Node and not `current_date` in SQL: the first is the
 * server's timezone, the second is the database's, and neither is necessarily
 * the owner's. core.today() reads core.settings.timezone, so every module and
 * every screen agree about what day it is even when the three clocks do not.
 *
 * Memoised per request: Goals asks once per goal through Tasks' linked seam,
 * and the day does not change mid-render.
 */
export const ownerToday = cache(async (): Promise<string> => {
  const { rows } = await db().query<{ today: string }>(`select core.today()::text as today`)
  return rows[0].today
})

// The zone formatters live in clock.ts, which has no database import, so a
// client component can use them; they are re-exported here for the callers
// that already read them from today.
export { clockIn, dayIn, minutesIn, zoneAbbrIn } from './clock'

/**
 * The hour the nightly cron fires, in UTC.
 *
 * Kept here as a constant rather than read from vercel.json at runtime: the
 * value is needed in a React render and reading a file there is the wrong
 * shape. today.test.ts asserts the two agree, so drift fails a test rather
 * than quietly telling the owner the wrong time.
 */
export const NIGHTLY_UTC_HOUR = 9

/**
 * When the nightly run actually happens, in the owner's timezone.
 *
 * Built from a real date rather than an offset, so daylight saving is handled:
 * 09:00 UTC is 03:00 in Chicago in January and 04:00 in July, and this returns
 * whichever is true today.
 */
export function nightlyRunAt(timeZone: string, on: Date = new Date()): string {
  const utc = new Date(
    Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate(), NIGHTLY_UTC_HOUR, 0, 0),
  )
  return clockIn(utc, timeZone)
}
