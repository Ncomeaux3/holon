import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const complete = vi.fn()
vi.mock('./llm', () => ({ complete: (...args: unknown[]) => complete(...args) }))

const { db } = await import('./db')
const { register } = await import('./entities')

beforeEach(() => {
  complete.mockReset()
  complete.mockResolvedValue('[]')
})
afterEach(async () => {
  await db().query('delete from core.events')
  await db().query('delete from core.entities')
})
afterAll(async () => {
  await db().end()
})

const counts = async (ref: string) => {
  const [entities, links, events] = await Promise.all([
    db().query('select * from core.entities where id = $1', [ref]),
    db().query('select * from core.skill_links where entity_ref = $1', [ref]),
    db().query('select * from core.events where entity_ref = $1', [ref]),
  ])
  return { entity: entities.rows[0], links: links.rows, events: events.rows }
}

describe('register', () => {
  it('creates one entity, at least one skill link, and one event in a single call', async () => {
    const ref = await register({
      module: 'notes',
      entityType: 'note',
      entityId: 'note-1',
      title: 'Deadlift form check',
      text: 'Bar drifting forward off the floor.',
    })

    const { entity, links, events } = await counts(ref)
    expect(entity).toMatchObject({ module: 'notes', entity_type: 'note', entity_id: 'note-1' })
    expect(links.length).toBeGreaterThanOrEqual(1)
    expect(links[0].skill_id).toBe('strength')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event_type: 'note_created', title_snapshot: 'Deadlift form check' })
  })

  it('classifies on the title and the text together', async () => {
    const ref = await register({
      module: 'notes',
      entityType: 'note',
      entityId: 'note-2',
      title: 'Weekend project',
      text: 'Wrote a postgres migration.',
    })
    const { links } = await counts(ref)
    expect(links.map((l) => l.skill_id)).toContain('sql')
  })

  it('stores the text as the entity body so search and embedding can read it', async () => {
    const ref = await register({
      module: 'notes',
      entityType: 'note',
      entityId: 'note-3',
      title: 'A title',
      text: 'The indexable body.',
    })
    expect((await counts(ref)).entity.body).toBe('The indexable body.')
  })

  // Imports re-run. Registering the same module row twice must update it, not
  // create a second entity.
  it('is idempotent on module, type, and id', async () => {
    const args = { module: 'notes', entityType: 'note', entityId: 'note-4', title: 'First title' }
    const first = await register(args)
    const second = await register({ ...args, title: 'Renamed' })

    expect(second).toBe(first)
    const { rows } = await db().query('select title from core.entities')
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('Renamed')
  })

  it('lets the caller name the event type and backdate it for imports', async () => {
    const when = new Date('2021-04-05T12:00:00Z')
    const ref = await register({
      module: 'notes',
      entityType: 'note',
      entityId: 'note-5',
      title: 'An imported note',
      eventType: 'book_finished',
      occurredAt: when,
    })
    const { events } = await counts(ref)
    expect(events[0].event_type).toBe('book_finished')
    expect(events[0].occurred_at.toISOString()).toBe(when.toISOString())
  })

  it('defaults the event type to <entityType>_created', async () => {
    const ref = await register({
      module: 'notes',
      entityType: 'workout',
      entityId: 'w-1',
      title: 'Squats',
    })
    expect((await counts(ref)).events[0].event_type).toBe('workout_created')
  })

  // A note that cannot be classified is still a note.
  it('still writes the entity and event when classification fails outright', async () => {
    complete.mockRejectedValue(new Error('overloaded'))
    const ref = await register({
      module: 'notes',
      entityType: 'note',
      entityId: 'note-6',
      title: 'The quiet afternoon passed',
    })
    const { entity, events, links } = await counts(ref)
    expect(entity).toBeDefined()
    expect(events).toHaveLength(1)
    expect(links[0].classified_by).toBe('unclassified')
  })
})

describe('re-registering the same row', () => {
  it('does not emit a second creation event, so XP is not awarded twice', async () => {
    const args = {
      module: 'notes',
      entityType: 'note',
      entityId: 'twice-1',
      title: 'Deadlift form check',
    }

    const first = await register(args)
    const second = await register({ ...args, title: 'Deadlift form check, edited' })

    expect(second).toBe(first)
    const { events, entity } = await counts(first)
    // Every setup:demo and every e2e seed run re-registers. Before this the
    // five demo notes had thirty-eight creation events each.
    expect(events).toHaveLength(1)
    expect(entity.title).toBe('Deadlift form check, edited')
  })

  it('still emits a named event, because that is something that happened again', async () => {
    const args = { module: 'tasks', entityType: 'task', entityId: 'twice-2', title: 'Ship it' }

    const ref = await register(args)
    await register({ ...args, eventType: 'task_completed' })

    const { events } = await counts(ref)
    expect(events.map((e) => e.event_type).sort()).toEqual(['task_completed', 'task_created'])
  })

  it('moves a seeded event rather than adding one when the seed asks to replace it', async () => {
    const args = { module: 'fitness', entityType: 'workout', entityId: 'twice-3', title: 'Lower', eventType: 'workout_logged' }

    // Every e2e run re-seeds: 13,710 workout events on 10 demo workouts locally.
    const ref = await register({ ...args, occurredAt: new Date('2026-09-01T18:00:00Z'), replace: true })
    await register({ ...args, occurredAt: new Date('2026-09-02T18:00:00Z'), replace: true })

    const { events } = await counts(ref)
    expect(events.map((e) => e.event_type)).toEqual(['workout_logged'])
  })
})
