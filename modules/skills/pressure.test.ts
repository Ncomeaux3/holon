import { describe, expect, it } from 'vitest'
import { underGoalPressure } from './pressure'

const row = (skillId: string, goalWeight: number, gained30d: number) => ({
  skillId,
  name: skillId,
  goalWeight,
  gained30d,
})

describe('underGoalPressure', () => {
  it('keeps only the skills a goal points at that have not moved', () => {
    // No goal weight is no pressure; XP this month is not low activity.
    const out = underGoalPressure([row('sql', 0, 0), row('writing', 1.2, 40), row('speaking', 0.8, 0)], 5)
    expect(out.map((r) => r.skillId)).toEqual(['speaking'])
  })

  it('puts the heaviest weight first and stops at the limit', () => {
    const out = underGoalPressure(
      [row('a', 0.5, 0), row('b', 2, 0), row('c', 1, 0), row('d', 0.9, 0)],
      3,
    )
    expect(out.map((r) => r.skillId)).toEqual(['b', 'c', 'd'])
  })
})
