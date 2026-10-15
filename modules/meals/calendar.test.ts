import { describe, expect, it } from 'vitest'
import { toCalendarItems } from './calendar'

const range = { from: '2026-09-01', to: '2026-09-30' }

const row = (over: Partial<Parameters<typeof toCalendarItems>[0][number]> = {}) => ({
  id: 'e1',
  on_date: '2026-09-15',
  slot: 'dinner',
  label: '',
  recipe_name: 'Chicken traybake',
  eaten: false,
  ...over,
})

describe('toCalendarItems', () => {
  it('titles it with the capitalised slot and the recipe', () => {
    const [item] = toCalendarItems([row()], range)
    expect(item.title).toBe('Dinner: Chicken traybake')
    expect(item.allDay).toBe(true)
  })

  it('falls back to the label when there is no recipe', () => {
    const [item] = toCalendarItems([row({ recipe_name: null, label: 'Leftovers' })], range)
    expect(item.title).toBe('Dinner: Leftovers')
  })

  it('marks an eaten entry done', () => {
    const [item] = toCalendarItems([row({ eaten: true })], range)
    expect(item.done).toBe(true)
  })

  it('drops an entry outside the range', () => {
    expect(toCalendarItems([row({ on_date: '2026-10-01' })], range)).toHaveLength(0)
  })
})
