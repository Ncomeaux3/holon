import { describe, expect, it } from 'vitest'
import { fillWeek } from './fill'

const recipes = [
  { id: 'oats', tags: ['breakfast'], favourite: false },
  { id: 'yogurt', tags: ['breakfast', 'quick'], favourite: true },
  { id: 'chili', tags: ['dinner', 'batch'], favourite: true },
  { id: 'soup', tags: ['lunch', 'dinner'], favourite: false },
]

describe('fillWeek', () => {
  it('fills an empty slot with a recipe tagged for it, favourites first', () => {
    const picks = fillWeek([{ on_date: '2026-09-14', slot: 'breakfast' }], recipes)
    expect(picks).toEqual([{ on_date: '2026-09-14', slot: 'breakfast', recipe_id: 'yogurt' }])
  })

  it('rotates through the candidates by day and slot rather than repeating one', () => {
    const picks = fillWeek(
      [
        { on_date: '2026-09-14', slot: 'breakfast' },
        { on_date: '2026-09-15', slot: 'breakfast' },
        { on_date: '2026-09-16', slot: 'breakfast' },
      ],
      recipes,
    )
    expect(picks.map((p) => p.recipe_id)).toEqual(['yogurt', 'oats', 'yogurt'])
  })

  it('leaves a slot empty when nothing is tagged for it, rather than guessing', () => {
    expect(fillWeek([{ on_date: '2026-09-14', slot: 'snack' }], recipes)).toEqual([])
  })
})
