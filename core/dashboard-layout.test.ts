import { describe, expect, it } from 'vitest'
import { arrange } from './dashboard-layout'

describe('arrange', () => {
  const ids = ['finance', 'goals', 'skills', 'llm']

  it('keeps the saved order and drops ids that are no longer tiles', () => {
    // A layout saved before Holon phase 3 named the tiles that became sections.
    const layout = { order: ['warnings', 'skills', 'tasks', 'finance', 'review', 'timeline'], hidden: ['timeline', 'llm'] }
    expect(arrange(ids, layout)).toEqual({
      sorted: ['skills', 'finance', 'goals', 'llm'],
      shown: ['skills', 'finance', 'goals'],
      hidden: ['llm'],
    })
  })

  it('is the server order with no layout', () => {
    expect(arrange(ids, null).shown).toEqual(ids)
  })
})
