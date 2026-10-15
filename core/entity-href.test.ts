import { describe, expect, it, vi } from 'vitest'

const manifests = [
  { id: 'tasks', entityHref: (t: string, id: string) => (t === 'task' ? `/tasks?task=${id}` : null) },
  { id: 'fitness' },
]
vi.mock('../modules/_index', () => ({ modules: manifests }))

const { entityHref } = await import('./modules')

describe('entityHref', () => {
  it('uses the module drawer url', () => {
    expect(entityHref('tasks', 'task', 'abc')).toBe('/tasks?task=abc')
  })
  it('falls back to the module page', () => {
    expect(entityHref('fitness', 'workout', 'w1')).toBe('/fitness')
    expect(entityHref('tasks', 'other', 'x')).toBe('/tasks')
  })
  it('is null for an unknown module', () => {
    expect(entityHref('nope', 'x', '1')).toBeNull()
  })
})
