// Date arithmetic on YYYY-MM-DD strings at noon UTC, so no zone or daylight
// saving change can move a day. Pure; the page and the screen both use it.

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * What one fetch covers for a month, YYYY-MM: the month plus a week each
 * side, so the phone's week strip at either edge has its neighbours' days.
 */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: addDays(`${month}-01`, -7), to: addDays(`${month}-${String(last).padStart(2, '0')}`, 7) }
}
