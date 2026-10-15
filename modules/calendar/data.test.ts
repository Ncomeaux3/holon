import { afterAll, afterEach, describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const { db } = await import('@/core/db')
const { deleteEvent, listEvents, toItems, writeEvent } = await import('./data')
const { EVENT_INPUT } = await import('./manifest')

// v1.2 phase 6a. A typed event round-trips in the owner's zone, a feed's row
// cannot be edited or deleted from here, and a timed event ending before it
// starts is refused at the tool's input.

afterEach(async () => {
  await db().query(`delete from calendar.event`)
})

afterAll(async () => {
  await db().end()
})

describe('calendar events', () => {
  it('stores a timed event and reads it back on the same wall clock', async () => {
    await writeEvent({ title: 'Dentist', on_date: '2026-10-05', all_day: false, starts: '09:15', ends: '10:00' }, 'manual')
    const items = toItems(await listEvents({ from: '2026-10-01', to: '2026-10-31' }))
    expect(items).toMatchObject([
      { title: 'Dentist', startsAt: '2026-10-05T09:15', endsAt: '2026-10-05T10:00', allDay: false, kind: 'event' },
    ])
  })

  it('keeps an all-day event on its date', async () => {
    await writeEvent({ title: 'Holiday', on_date: '2026-10-31', all_day: true }, 'manual')
    const items = toItems(await listEvents({ from: '2026-10-31', to: '2026-10-31' }))
    expect(items).toMatchObject([{ startsAt: '2026-10-31', allDay: true }])
  })

  it('refuses to edit or delete an event from a feed', async () => {
    const { rows } = await db().query<{ id: string }>(
      `insert into calendar.event (source, external_id, title, starts_at) values ('google', 'g1', 'Standup', now()) returning id`,
    )
    await expect(
      writeEvent({ id: rows[0].id, title: 'Renamed', on_date: '2026-10-05', all_day: true }, 'manual'),
    ).rejects.toThrow(/typed here/)
    await expect(deleteEvent(rows[0].id)).rejects.toThrow(/typed here/)
  })

  it('refuses a timed event that ends before it starts', () => {
    const parsed = EVENT_INPUT.safeParse({ title: 'x', on_date: '2026-10-05', all_day: false, starts: '10:00', ends: '09:00' })
    expect(parsed.success).toBe(false)
  })
})
