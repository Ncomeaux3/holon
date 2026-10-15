import { describe, expect, it } from 'vitest'
import { per100 } from './client'

describe('per100', () => {
  it('reads SR Legacy energy from 1008', () => {
    expect(per100([{ nutrientId: 1008, value: 440 }, { nutrientId: 1003, value: 9.58 }, { nutrientId: 1004, value: 44.2 }, { nutrientId: 1005, value: 0.79 }])).toEqual({
      kcal: 440,
      protein: 9.58,
      carbs: 0.79,
      fat: 44.2,
    })
  })

  it('falls back to Atwater energy for a Foundation food and floors a negative carb', () => {
    expect(per100([{ nutrientId: 2047, value: 188 }, { nutrientId: 2048, value: 193 }, { nutrientId: 1003, value: 17.1 }, { nutrientId: 1005, value: -0.173 }])).toEqual({
      kcal: 188,
      protein: 17.1,
      carbs: 0,
      fat: 0,
    })
  })
})
