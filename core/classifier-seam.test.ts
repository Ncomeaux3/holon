import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

// The seam that makes Skill Tree a module rather than part of core: register()
// classifies through whatever module declares a `classifier`. These tests are
// the substitute for deleting modules/skills and checking the app still runs.

const manifests: { id: string; classifier?: unknown }[] = []
vi.mock('../modules/_index', () => ({
  get modules() {
    return manifests
  },
}))

const { db } = await import('./db')
const { register } = await import('./entities')
const { getClassifier } = await import('./modules')

const base = { id: 'x', nav: { label: 'X', order: 1 }, pages: {}, tools: {} }

afterEach(async () => {
  manifests.length = 0
  await db().query('delete from core.events')
  await db().query('delete from core.entities')
})
afterAll(async () => {
  await db().end()
})

describe('getClassifier', () => {
  it('is undefined when no module declares one', () => {
    manifests.push({ ...base })
    expect(getClassifier()).toBeUndefined()
  })

  it('returns the one a module declares', () => {
    const classifier = vi.fn()
    manifests.push({ ...base }, { ...base, id: 'skills', classifier })
    expect(getClassifier()).toBe(classifier)
  })

  // Two would each write core.skill_links for the same entity and the winner
  // would depend on array order. Throwing is the only honest answer.
  it('throws when two modules declare one, naming both', () => {
    manifests.push({ ...base, id: 'skills', classifier: vi.fn() }, { ...base, id: 'other', classifier: vi.fn() })
    expect(() => getClassifier()).toThrow(/skills, other/)
  })
})

describe('register without a classifier', () => {
  it('still registers the entity and emits the event', async () => {
    manifests.push({ ...base, id: 'notes' })

    const ref = await register({
      module: 'notes',
      entityType: 'note',
      entityId: 'seam-1',
      title: 'Deadlift form check',
      text: 'Would match the strength keyword if anything were classifying.',
    })

    const [entity, links, events] = await Promise.all([
      db().query('select title from core.entities where id = $1', [ref]),
      db().query('select * from core.skill_links where entity_ref = $1', [ref]),
      db().query('select event_type from core.events where entity_ref = $1', [ref]),
    ])

    expect(entity.rows[0].title).toBe('Deadlift form check')
    expect(events.rows[0].event_type).toBe('note_created')
    // No skills module, no links, and no error. That is the seam working.
    expect(links.rows).toHaveLength(0)
  })
})

describe('register with a classifier', () => {
  it('passes the entity ref, the joined text and the module', async () => {
    const classifier = vi.fn().mockResolvedValue(undefined)
    manifests.push({ ...base, id: 'notes' }, { ...base, id: 'skills', classifier })

    const ref = await register({
      module: 'notes',
      entityType: 'note',
      entityId: 'seam-2',
      title: 'Title',
      text: 'Body',
    })

    expect(classifier).toHaveBeenCalledWith(ref, 'Title\nBody', 'notes')
  })
})
