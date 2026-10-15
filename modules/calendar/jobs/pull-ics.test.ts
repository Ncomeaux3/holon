import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

// The feed is fetched through core/fetching, which refuses a private address:
// the test replaces the fetch, never the address rules.
const served = new Map<string, string>()
let truncate = false
vi.mock('@/core/fetching', async () => {
  const actual = await vi.importActual<typeof import('@/core/fetching')>('@/core/fetching')
  return {
    ...actual,
    get: async (url: string) => {
      const body = served.get(url)
      if (body === undefined) return { status: 404, location: null, contentType: '', body: '', truncated: false }
      return { status: 200, location: null, contentType: 'text/calendar', body, truncated: truncate }
    },
  }
})

const { db } = await import('@/core/db')
const { saveCredentials } = await import('@/core/credentials')
const { feedKey } = await import('@/integrations/ics/client')
const { pullIcs } = await import('./pull-ics')
const { listEvents } = await import('../data')

const FEED = 'https://p01.icloud.com/published/2/family'
const OTHER = 'https://p01.icloud.com/published/2/work'
const KEY = feedKey(FEED)

const calendar = (name: string, ...events: string[]) =>
  ['BEGIN:VCALENDAR', `X-WR-CALNAME:${name}`, ...events, 'END:VCALENDAR'].join('\n')

const event = (uid: string, date: string, summary: string) =>
  ['BEGIN:VEVENT', `UID:${uid}`, `DTSTART;VALUE=DATE:${date}`, `SUMMARY:${summary}`, 'END:VEVENT'].join('\n')

// Dated from today, so the rows land inside the pull's own window.
const inDays = (n: number) => {
  const d = new Date(Date.now() + n * 86_400_000)
  return d.toISOString().slice(0, 10)
}
const compact = (iso: string) => iso.replace(/-/g, '')

const stored = async () =>
  (
    await db().query<{ external_id: string; title: string }>(
      `select external_id, title from calendar.event where source = 'ics' order by external_id`,
    )
  ).rows

describe('pullIcs', () => {
  beforeEach(async () => {
    served.clear()
    truncate = false
    served.set(FEED, calendar('Family', event('dinner', compact(inDays(3)), 'Dinner')))
    await saveCredentials('ics', { urls: JSON.stringify([FEED]) })
  })

  afterEach(async () => {
    await db().query(`delete from calendar.event`)
    await db().query(`delete from core.connections`)
  })

  afterAll(async () => {
    await db().end()
  })

  it('stores a feed\'s events under its own key and updates them in place', async () => {
    await expect(pullIcs()).resolves.toMatchObject({ skipped: false, fetched: 1, removed: 0 })
    expect(await stored()).toEqual([{ external_id: `${KEY}/dinner`, title: 'Dinner' }])

    served.set(FEED, calendar('Family', event('dinner', compact(inDays(3)), 'Dinner, later')))
    await pullIcs()
    expect(await stored()).toEqual([{ external_id: `${KEY}/dinner`, title: 'Dinner, later' }])
  })

  it('deletes an event the feed stopped sending', async () => {
    served.set(
      FEED,
      calendar('Family', event('dinner', compact(inDays(3)), 'Dinner'), event('gone', compact(inDays(4)), 'Gone')),
    )
    await pullIcs()
    served.set(FEED, calendar('Family', event('dinner', compact(inDays(3)), 'Dinner')))
    await expect(pullIcs()).resolves.toMatchObject({ removed: 1 })
    expect((await stored()).map((r) => r.external_id)).toEqual([`${KEY}/dinner`])
  })

  it('removes every row of a calendar taken off the list', async () => {
    served.set(OTHER, calendar('Work', event('review', compact(inDays(2)), 'Review')))
    await saveCredentials('ics', { urls: JSON.stringify([FEED, OTHER]) })
    await pullIcs()
    expect(await stored()).toHaveLength(2)

    await saveCredentials('ics', { urls: JSON.stringify([FEED]) })
    await pullIcs()
    expect((await stored()).map((r) => r.external_id)).toEqual([`${KEY}/dinner`])
  })

  it('puts an all day event on its own date in the owner\'s zone, with the feed\'s name', async () => {
    await pullIcs()
    expect(await listEvents({ from: inDays(0), to: inDays(10) })).toMatchObject([
      { on_date: inDays(3), all_day: true, source: 'ics', calendar_name: 'Family', title: 'Dinner' },
    ])
  })

  it('names a rule it could not expand in its own detail line', async () => {
    served.set(
      FEED,
      calendar(
        'Family',
        [
          'BEGIN:VEVENT',
          'UID:payday',
          `DTSTART;VALUE=DATE:${compact(inDays(1))}`,
          'RRULE:FREQ=MONTHLY;BYMONTHDAY=15,-1',
          'SUMMARY:Payday',
          'END:VEVENT',
        ].join('\n'),
      ),
    )
    await expect(pullIcs()).resolves.toMatchObject({
      detail: expect.stringContaining('Payday: FREQ=MONTHLY;BYMONTHDAY=15,-1 is kept as one event.'),
    })
  })

  it('fails with the URL that broke, not a bare status', async () => {
    await saveCredentials('ics', { urls: JSON.stringify(['https://p01.icloud.com/published/2/missing']) })
    await expect(pullIcs()).rejects.toThrow('https://p01.icloud.com/published/2/missing: That URL answered 404.')
  })

  it('leaves one working feed\'s rows alone when another fails', async () => {
    await pullIcs()
    await saveCredentials('ics', { urls: JSON.stringify([FEED, 'https://p01.icloud.com/published/2/missing']) })
    await expect(pullIcs()).rejects.toThrow()
    expect((await stored()).map((r) => r.external_id)).toEqual([`${KEY}/dinner`])
  })

  // Removing the last calendar, or pressing Disconnect, is an empty list, and
  // the rows have to go with it rather than sit on the screen for good.
  it('takes the last calendar\'s rows with it when the list empties', async () => {
    await pullIcs()
    await saveCredentials('ics', { urls: JSON.stringify([]) })
    await expect(pullIcs()).resolves.toMatchObject({ skipped: true, removed: 1 })
    expect(await stored()).toEqual([])
  })

  it('says it skipped, and clears what it brought, when the connection is gone', async () => {
    await pullIcs()
    await db().query(`delete from core.connections`)
    await expect(pullIcs()).resolves.toMatchObject({ skipped: true, removed: 1 })
    expect(await stored()).toEqual([])
  })

  it('refuses a body that hit the byte cap rather than deleting what fell off it', async () => {
    truncate = true
    await expect(pullIcs()).rejects.toThrow('over the 5 MB limit')
  })
})
