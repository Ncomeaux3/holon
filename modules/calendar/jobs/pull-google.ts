import {
  calendars,
  events,
  type GoogleCalendar,
  type GoogleEvent,
  googleCredentials,
  pickedIds,
} from '@/integrations/google/client'
import { dropFeeds, type FeedRow, storeFeed } from './feed'

// The owner's Google calendars into calendar.event, read only.
//
// A full window each run, not sync tokens (owner's choice, 2026-09-23): the
// window moves forward every night, and anything in it Google no longer
// returns is deleted, so a missed run or a moved event mends itself.

const DAY = 86_400_000
const BACK_DAYS = 30
const AHEAD_DAYS = 365

export type GoogleRow = FeedRow & { raw: GoogleEvent }

function dayBefore(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - DAY).toISOString().slice(0, 10)
}

export function toRow(e: GoogleEvent, cal: Pick<GoogleCalendar, 'id' | 'summary'>): GoogleRow | null {
  if (e.status === 'cancelled') return null
  const allDay = Boolean(e.start.date)
  const start = e.start.date ?? e.start.dateTime
  if (!start) return null

  // Google's end.date is exclusive; calendar.event stores the last day.
  const end = allDay ? (e.end?.date ? dayBefore(e.end.date) : null) : (e.end?.dateTime ?? null)

  return {
    external_id: `${cal.id}/${e.id}`,
    calendar_name: cal.summary,
    title: (e.summary?.trim() || '(No title)').slice(0, 200),
    starts_at: start,
    // A malformed all day end before its start would break the table's check.
    ends_at: allDay && end && end < start ? null : end,
    all_day: allDay,
    location: e.location ?? '',
    url: e.htmlLink ?? '',
    raw: e,
  }
}

/**
 * Never skips silently: not connected returns a skipped result, and a Google
 * failure throws so the job row says failed and the band shows it.
 */
export async function pullGoogle(now = new Date()) {
  const creds = await googleCredentials()
  if (!creds?.access_token) {
    return { skipped: true, fetched: 0, removed: 0, detail: 'Google is not connected.' }
  }

  const all = await calendars(creds.access_token)
  const ids = pickedIds(creds, all)
  const picked = all.filter((c) => ids.includes(c.id))

  // A calendar unticked since the last pull leaves with all of its rows.
  const dropped = await dropFeeds('google', picked.map((c) => c.id))

  const from = new Date(now.getTime() - BACK_DAYS * DAY)
  const to = new Date(now.getTime() + AHEAD_DAYS * DAY)
  let fetched = 0
  let removed = dropped

  for (const cal of picked) {
    const rows = (await events(cal.id, from, to, creds.access_token))
      .map((e) => toRow(e, cal))
      .filter((r): r is GoogleRow => r !== null)
    fetched += rows.length
    removed += await storeFeed('google', cal.id, rows, from, to)
  }

  return {
    skipped: false,
    fetched,
    removed,
    detail: `${fetched} events from ${picked.length} calendars, ${removed} removed.`,
  }
}
