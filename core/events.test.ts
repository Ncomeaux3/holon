import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { emit } from './events'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

async function anEntity(title: string): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into core.entities (module, entity_type, entity_id, title)
     values ('notes', 'note', gen_random_uuid()::text, $1) returning id`,
    [title],
  )
  return rows[0].id
}

afterEach(async () => {
  await db().query('delete from core.events')
  await db().query('delete from core.entities')
})
afterAll(async () => {
  await db().end()
})

describe('emit', () => {
  it('snapshots the entity title so the event survives the row', async () => {
    const ref = await anEntity('Read Designing Data-Intensive Applications')
    await emit({ module: 'notes', entityRef: ref, eventType: 'note_created' })

    const { rows } = await db().query('select * from core.events')
    expect(rows).toHaveLength(1)
    expect(rows[0].title_snapshot).toBe('Read Designing Data-Intensive Applications')
  })

  // Deletes are hard. The snapshot is the whole reason the event log survives one.
  it('keeps the snapshot after the entity is deleted, with a null ref', async () => {
    const ref = await anEntity('Deadlift form check')
    await emit({ module: 'notes', entityRef: ref, eventType: 'note_created' })
    await db().query('delete from core.entities where id = $1', [ref])

    const { rows } = await db().query('select title_snapshot, entity_ref from core.events')
    expect(rows).toHaveLength(1)
    expect(rows[0].title_snapshot).toBe('Deadlift form check')
    expect(rows[0].entity_ref).toBeNull()
  })

  it('prefers an explicit snapshot over the entity title', async () => {
    const ref = await anEntity('Current title')
    await emit({
      module: 'notes',
      entityRef: ref,
      eventType: 'note_created',
      titleSnapshot: 'What it was called then',
    })
    const { rows } = await db().query('select title_snapshot from core.events')
    expect(rows[0].title_snapshot).toBe('What it was called then')
  })

  it('stores the payload and defaults it to an empty object', async () => {
    const ref = await anEntity('x')
    await emit({ module: 'notes', entityRef: ref, eventType: 'note_created', payload: { n: 1 } })
    await emit({ module: 'notes', entityRef: ref, eventType: 'note_created' })

    const { rows } = await db().query(
      'select payload from core.events order by jsonb_typeof(payload), payload::text',
    )
    expect(rows.map((r) => r.payload)).toEqual(expect.arrayContaining([{}, { n: 1 }]))
  })

  // Imports backdate events so the skill tree reflects real history.
  it('accepts a backdated occurred_at for imported history', async () => {
    const ref = await anEntity('An old note')
    const when = new Date('2021-04-05T12:00:00Z')
    await emit({ module: 'notes', entityRef: ref, eventType: 'note_created', occurredAt: when })

    const { rows } = await db().query<{ occurred_at: Date }>('select occurred_at from core.events')
    expect(rows[0].occurred_at.toISOString()).toBe(when.toISOString())
  })

  it('defaults occurred_at to now when nothing is passed', async () => {
    const ref = await anEntity('x')
    await emit({ module: 'notes', entityRef: ref, eventType: 'note_created' })
    const { rows } = await db().query<{ occurred_at: Date }>('select occurred_at from core.events')
    expect(Date.now() - rows[0].occurred_at.getTime()).toBeLessThan(10_000)
  })
})
