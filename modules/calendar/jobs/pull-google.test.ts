import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoogleEvent } from '@/integrations/google/client'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const { db } = await import('@/core/db')
const { saveCredentials } = await import('@/core/credentials')
const { pullGoogle, toRow } = await import('./pull-google')
const { listEvents } = await import('../data')

const cal = { id: 'work@example.com', summary: 'Work' }

const event = (over: Partial<GoogleEvent>): GoogleEvent => ({
  id: 'evt1',
  status: 'confirmed',
  summary: 'Standup',
  start: { dateTime: '2026-10-01T09:00:00-05:00' },
  end: { dateTime: '2026-10-01T09:15:00-05:00' },
  ...over,
})

describe('toRow', () => {
  it('maps a timed event, keeping the offset Google sent', () => {
    const row = toRow(event({ location: 'Room 4', htmlLink: 'https://calendar.google.com/e/1' }), cal)
    expect(row).toMatchObject({
      external_id: 'work@example.com/evt1',
      calendar_name: 'Work',
      title: 'Standup',
      all_day: false,
      starts_at: '2026-10-01T09:00:00-05:00',
      ends_at: '2026-10-01T09:15:00-05:00',
      location: 'Room 4',
      url: 'https://calendar.google.com/e/1',
    })
  })

  // Google's end.date is exclusive: a one day event ends the next day.
  it('stores an all day event by date with the last day inclusive', () => {
    const row = toRow(event({ start: { date: '2026-10-03' }, end: { date: '2026-10-04' } }), cal)
    expect(row).toMatchObject({ all_day: true, starts_at: '2026-10-03', ends_at: '2026-10-03' })
  })

  it('spans a multi day all day event to its real last day, across a month end', () => {
    const row = toRow(event({ start: { date: '2026-10-30' }, end: { date: '2026-11-02' } }), cal)
    expect(row).toMatchObject({ starts_at: '2026-10-30', ends_at: '2026-11-01' })
  })

  // An invite sits in two calendars under one event id; the prefix keeps both.
  it('keys the row by calendar and event, so a shared invite is one row per calendar', () => {
    expect(toRow(event({}), { id: 'family@example.com', summary: 'Family' })?.external_id).toBe(
      'family@example.com/evt1',
    )
  })

  it('names an untitled event the way Google does and caps a long title', () => {
    expect(toRow(event({ summary: undefined }), cal)?.title).toBe('(No title)')
    expect(toRow(event({ summary: 'x'.repeat(300) }), cal)?.title).toHaveLength(200)
  })

  it('keeps a recurring instance as its own row', () => {
    const row = toRow(event({ id: 'weekly_20261008T140000Z', start: { dateTime: '2026-10-08T09:00:00-05:00' } }), cal)
    expect(row?.external_id).toBe('work@example.com/weekly_20261008T140000Z')
  })

  it('drops a cancelled event', () => {
    expect(toRow(event({ status: 'cancelled' }), cal)).toBeNull()
  })

  it('leaves the end empty when Google sends none', () => {
    expect(toRow(event({ end: undefined }), cal)?.ends_at).toBeNull()
  })
})

// The pull against a stubbed Google: what it returns is upserted, what it
// stops returning inside the window is deleted, and an unticked calendar
// leaves with all of its rows.
describe('pullGoogle', () => {
  const now = new Date('2026-10-01T12:00:00Z')
  let served: Record<string, GoogleEvent[]>

  beforeEach(async () => {
    await saveCredentials(
      'google',
      { access_token: 'token', refresh_token: 'refresh', calendars: JSON.stringify(['work@example.com']) },
      { expiresAt: new Date(Date.now() + 3_600_000) },
    )
    served = { 'work@example.com': [event({})], 'family@example.com': [event({ id: 'dinner' })] }
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/calendarList')) {
        return Response.json({
          items: [
            { id: 'work@example.com', summary: 'Work', selected: true },
            { id: 'family@example.com', summary: 'Family', selected: true },
          ],
        })
      }
      const id = decodeURIComponent(url.pathname.split('/calendars/')[1].split('/events')[0])
      return Response.json({ items: served[id] ?? [] })
    })
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await db().query(`delete from calendar.event`)
    await db().query(`delete from core.connections`)
  })

  afterAll(async () => {
    await db().end()
  })

  const stored = async () =>
    (await db().query<{ external_id: string; title: string }>(
      `select external_id, title from calendar.event where source = 'google' order by external_id`,
    )).rows

  it('pulls only the picked calendars and updates a row in place on the next run', async () => {
    await expect(pullGoogle(now)).resolves.toMatchObject({ skipped: false, fetched: 1, removed: 0 })
    served['work@example.com'] = [event({ summary: 'Standup, moved' })]
    await pullGoogle(now)
    expect(await stored()).toEqual([{ external_id: 'work@example.com/evt1', title: 'Standup, moved' }])
  })

  it('deletes an event Google stopped returning inside the window', async () => {
    served['work@example.com'] = [event({}), event({ id: 'gone' })]
    await pullGoogle(now)
    served['work@example.com'] = [event({})]
    await expect(pullGoogle(now)).resolves.toMatchObject({ removed: 1 })
    expect((await stored()).map((r) => r.external_id)).toEqual(['work@example.com/evt1'])
  })

  it('removes every row of a calendar the owner unticked', async () => {
    await db().query(
      `insert into calendar.event (source, external_id, title, starts_at) values ('google', 'family@example.com/old', 'Old', now())`,
    )
    await pullGoogle(now)
    expect((await stored()).map((r) => r.external_id)).toEqual(['work@example.com/evt1'])
  })

  it('puts an all day event on its own date in the owner\'s zone', async () => {
    served['work@example.com'] = [event({ start: { date: '2026-10-03' }, end: { date: '2026-10-04' } })]
    await pullGoogle(now)
    expect(await listEvents({ from: '2026-10-01', to: '2026-10-31' })).toMatchObject([
      { on_date: '2026-10-03', all_day: true, end_date: '2026-10-03', source: 'google' },
    ])
  })

  it('fails with a sentence, not Google\'s JSON, when the token is refused', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: { code: 401, message: 'Request had invalid authentication credentials.' } }, { status: 401 }))
    await expect(pullGoogle(now)).rejects.toThrow('Google refused the token. Reauthorize Google to fix it.')
  })

  it("keeps Google's own message for a bad request that is not about the token", async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: { code: 400, message: 'Bad Request' } }, { status: 400 }))
    await expect(pullGoogle(now)).rejects.toThrow('Google 400: Bad Request')
  })

  it('reads a revoked grant on refresh as a refused token', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret')
    await saveCredentials('google', { access_token: 'token', refresh_token: 'refresh' }, { expiresAt: new Date(Date.now() - 60_000) })
    vi.stubGlobal('fetch', async () => Response.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 }))
    await expect(pullGoogle(now)).rejects.toThrow('Google refused the token. Reauthorize Google to fix it.')
    vi.unstubAllEnvs()
  })

  it('says it skipped when Google is not connected', async () => {
    await db().query(`delete from core.connections`)
    await expect(pullGoogle(now)).resolves.toMatchObject({ skipped: true })
  })
})
