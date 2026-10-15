import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/core/db'
import { callTool } from '@/core/tools'

// Against pos_test: write_item is what Gmail and the trip drawer both write
// through, and what is worth proving is what the row ends up as.

let tripId: string

beforeEach(async () => {
  await db().query(`delete from travel.trip where name = 'Write item test'`)
  const { rows } = await db().query<{ id: string }>(
    `insert into travel.trip (name, starts_on, ends_on, status)
     values ('Write item test', '2026-11-19', '2026-11-30', 'booked') returning id`,
  )
  tripId = rows[0].id
})

const item = async (id: string) =>
  (
    await db().query<Record<string, string | null>>(
      `select kind, status, place, provider, file_path, occurs_at::text, source
         from travel.itinerary_item where id = $1`,
      [id],
    )
  ).rows[0]

describe('travel.write_item', () => {
  it('stores an agent item as pending once, however often the same email is read', async () => {
    const input = { trip_id: tripId, title: 'LH 2401 MUC to VIE', occurs_on: '2026-11-27', occurs_at: '09:15', external_id: 'https://mail.google.com/mail/u/0/#all/abc' }
    const first = await callTool('travel', 'write_item', input, { source: 'agent' })
    const again = await callTool('travel', 'write_item', input, { source: 'agent' })

    const id = (first as { result: { id: string } }).result.id
    expect(again).toMatchObject({ status: 'done', result: { id: null, duplicate: true } })
    expect(await item(id)).toMatchObject({ kind: 'flight', status: 'pending', occurs_at: '09:15:00', source: 'agent' })
    const { rows } = await db().query(`select 1 from travel.itinerary_item where trip_id = $1`, [tripId])
    expect(rows).toHaveLength(1)
  })

  it('keeps an agent from confirming an item by updating it', async () => {
    const made = await callTool('travel', 'write_item', { trip_id: tripId, title: 'Opera' }, { source: 'agent' })
    const id = (made as { result: { id: string } }).result.id
    await callTool('travel', 'write_item', { id, status: 'confirmed' }, { source: 'agent' })
    expect((await item(id)).status).toBe('pending')
  })

  it('takes an idea, a city of its own and a reservation from the owner', async () => {
    const made = await callTool(
      'travel',
      'write_item',
      { trip_id: tripId, title: 'Hotel Sacher', kind: 'other', status: 'idea', place: 'Vienna', provider: 'Sacher', file_path: `${tripId}/conf.pdf` },
      { source: 'ui' },
    )
    const id = (made as { result: { id: string } }).result.id
    expect(await item(id)).toMatchObject({ kind: 'other', status: 'idea', place: 'Vienna', provider: 'Sacher', file_path: `${tripId}/conf.pdf`, source: 'manual' })
  })

  it("refuses a file outside the trip's own folder, on a new item and an update", async () => {
    await expect(
      callTool('travel', 'write_item', { trip_id: tripId, title: 'x', file_path: 'other-trip/a.pdf' }, { source: 'ui' }),
    ).rejects.toThrow("trip's own folder")
    for (const sneaky of [`${tripId}/../other/a.pdf`, `${tripId}/..`, `${tripId}/sub/a.pdf`]) {
      await expect(
        callTool('travel', 'write_item', { trip_id: tripId, title: 'x', file_path: sneaky }, { source: 'ui' }),
      ).rejects.toThrow("trip's own folder")
    }
    const made = await callTool('travel', 'write_item', { trip_id: tripId, title: 'Opera' }, { source: 'ui' })
    const id = (made as { result: { id: string } }).result.id
    await expect(callTool('travel', 'write_item', { id, file_path: 'other-trip/a.pdf' }, { source: 'agent' })).rejects.toThrow(
      "trip's own folder",
    )
  })
})

describe('travel.accept_item', () => {
  it('refuses an agent: the inbox is the owner\'s decision', async () => {
    const made = await callTool('travel', 'write_item', { trip_id: tripId, title: 'Opera' }, { source: 'agent' })
    const id = (made as { result: { id: string } }).result.id
    await expect(callTool('travel', 'accept_item', { id, accept: true }, { source: 'agent' })).rejects.toThrow('Only the owner')
    expect((await item(id)).status).toBe('pending')
  })

  it('keeps a rejected email item as dismissed, so the same email is not written again, and deletes any other', async () => {
    const mail = { trip_id: tripId, title: 'Opera', external_id: 'https://mail.google.com/mail/u/0/#all/x#2026-11-28' }
    const fromMail = (await callTool('travel', 'write_item', mail, { source: 'agent' })) as { result: { id: string } }
    const typed = (await callTool('travel', 'write_item', { trip_id: tripId, title: 'Guess' }, { source: 'agent' })) as {
      result: { id: string }
    }
    await callTool('travel', 'accept_item', { id: fromMail.result.id, accept: false }, { source: 'ui' })
    await callTool('travel', 'accept_item', { id: typed.result.id, accept: false }, { source: 'ui' })

    expect((await item(fromMail.result.id)).status).toBe('dismissed')
    expect(await item(typed.result.id)).toBeUndefined()
    const again = await callTool('travel', 'write_item', mail, { source: 'agent' })
    expect(again).toMatchObject({ result: { duplicate: true } })
  })
})
