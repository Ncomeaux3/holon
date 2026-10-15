// Wall-clock formatting in a named timezone. Pure and import free, so a
// client component can use it: a client component is also rendered on the
// server, where `new Date().getHours()` is UTC, and a time formatted in the
// renderer's zone is either five hours off or a hydration mismatch.

/**
 * The wall clock in a timezone, as parts.
 *
 * `new Date().getHours()` is the *server's* timezone, which on Vercel is UTC
 * and is never the owner's. That is not a rounding error: at 19:34 in Chicago
 * the server says 00:34 the next day, so a screen renders tomorrow's date and
 * a quiet hours window is checked against the wrong six hours.
 *
 * Intl does the conversion, so there is no date library and no offset table to
 * go stale when daylight saving moves.
 */
function partsIn(at: Date, timeZone: string): { day: number; month: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at)

  const find = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  // Intl renders midnight as 24 under hour12: false in some runtimes.
  const hour = find('hour') % 24
  return { day: find('day'), month: find('month'), minutes: hour * 60 + find('minute') }
}

/** "19:34" in the owner's timezone. */
export function clockIn(at: Date, timeZone: string): string {
  const { minutes } = partsIn(at, timeZone)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

// "7 Sep", not the locale's "7 Sept". Three letters, so the column stays the
// same width whichever month it is.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "9 SEP" in the owner's timezone. */
export function dayIn(at: Date, timeZone: string): string {
  const { day, month } = partsIn(at, timeZone)
  return `${day} ${MONTHS[month - 1]}`
}

/** "2026-09-11" in the owner's timezone: the calendar date a timestamp falls on. */
export function isoDateIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

/** Minutes since midnight in the owner's timezone. What quiet hours compares. */
export function minutesIn(at: Date, timeZone: string): number {
  return partsIn(at, timeZone).minutes
}

/** "CDT" for America/Chicago today, "CST" in winter: what a clock is printed with. */
export function zoneAbbrIn(timeZone: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')
  return part?.value ?? ''
}

/**
 * "11:44" for a run today in the owner's zone, "18 SEP 10:10" once it is
 * older, so a bare clock never means last week's. What a Sync band prints.
 */
export function syncClock(iso: string, timeZone: string, now: Date = new Date()): string {
  const at = new Date(iso)
  const time = clockIn(at, timeZone)
  return dayIn(at, timeZone) === dayIn(now, timeZone) ? time : `${dayIn(at, timeZone)} ${time}`
}

export type WeekStart = 'monday' | 'sunday'

/**
 * The first day of the week a date falls in, as YYYY-MM-DD: the one week for
 * every module (the owner's `week_start`). Noon UTC, so no timezone can move
 * the date it is counted from.
 */
export function startOfWeek(iso: string, weekStart: WeekStart): string {
  const d = new Date(`${iso}T12:00:00Z`)
  const back = (d.getUTCDay() - (weekStart === 'sunday' ? 0 : 1) + 7) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}
