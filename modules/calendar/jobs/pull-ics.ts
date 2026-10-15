import { getCredentials } from '@/core/credentials'
import { getSetting } from '@/core/settings'
import {
  fetchIcs,
  feedKey,
  feedUrls,
  type IcsEvent,
  parseIcs,
  pullWindow,
} from '@/integrations/ics/client'
import { dropFeeds, type FeedRow, storeFeed } from './feed'

// Published calendars into calendar.event, read only. Apple has no Calendar
// API; a calendar published from Calendar.app is an `.ics` file over https,
// and any other publisher's is the same.
//
// A full window each run, like the Google pull: what a feed stops returning
// inside the window is deleted, so a missed run or a moved event mends itself.

export function toRow(event: IcsEvent, key: string, calendarName: string): FeedRow {
  return {
    external_id: `${key}/${event.uid}`,
    calendar_name: calendarName,
    title: event.title,
    starts_at: event.start,
    ends_at: event.end,
    all_day: event.allDay,
    location: event.location,
    url: event.url,
    raw: event,
  }
}

/**
 * Never skips silently: no URL saved returns a skipped result, and a feed that
 * fails throws with the URL that broke, so the job row says failed and the
 * band shows it. The feeds read before it keep what they brought.
 */
export async function pullIcs(now = new Date()) {
  const urls = feedUrls(await getCredentials('ics'))

  // Before the early return, not after: a calendar taken off the list leaves
  // with all of its rows, and removing the last one, or disconnecting, is the
  // same thing with an empty list.
  let removed = await dropFeeds('ics', urls.map(feedKey))
  if (urls.length === 0) {
    return { skipped: true, fetched: 0, removed, detail: 'No calendar URL saved.' }
  }

  const { from, to } = pullWindow(now)
  const zone = await getSetting('timezone')
  const notes: string[] = []
  let fetched = 0

  for (const url of urls) {
    const key = feedKey(url)
    let calendar
    try {
      calendar = parseIcs(await fetchIcs(url), { from, to, zone })
    } catch (error) {
      throw new Error(`${url}: ${error instanceof Error ? error.message : 'did not answer.'}`)
    }

    const rows = calendar.events.map((e) => toRow(e, key, calendar.name))
    fetched += rows.length
    removed += await storeFeed('ics', key, rows, from, to)
    notes.push(...calendar.notes)
  }

  return {
    skipped: false,
    fetched,
    removed,
    detail: [`${fetched} events from ${urls.length} calendars, ${removed} removed.`, ...notes].join(' '),
  }
}
