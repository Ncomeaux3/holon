import { describe, expect, it } from 'vitest'
import { forGrams, gramsOf, perServing, standing, total, type PlannedMeal } from './macros'

const meal = (kcal: number, servings = 1, eaten = false): PlannedMeal => ({
  servings,
  eaten,
  macros: { kcal, protein: kcal / 10, carbs: kcal / 8, fat: kcal / 30 },
})

describe('total', () => {
  it('scales by servings rather than counting a recipe once', () => {
    // Half a batch of a 680 kcal recipe is 340, not 680.
    expect(total([meal(680, 0.5)]).kcal).toBe(340)
    expect(total([meal(680, 2)]).kcal).toBe(1360)
  })

  it('answers planned and eaten separately', () => {
    const meals = [meal(500, 1, true), meal(700, 1, false)]
    expect(total(meals).kcal).toBe(1200)
    expect(total(meals, true).kcal).toBe(500)
  })

  it('counts what it could not know rather than guessing at it', () => {
    // A meal with no recipe behind it contributes nothing, and the count is
    // what makes a low total visibly incomplete rather than quietly wrong.
    const meals: PlannedMeal[] = [meal(500), { servings: 1, eaten: false, macros: null }]
    const sum = total(meals)
    expect(sum.kcal).toBe(500)
    expect(sum.unknown).toBe(1)
  })

  it('is zero, not undefined, for an empty day', () => {
    expect(total([])).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0, unknown: 0 })
  })
})

describe('standing', () => {
  it('allows ten percent either side, because nobody hits a target exactly', () => {
    expect(standing(2400, 2400)).toBe('on')
    expect(standing(2300, 2400)).toBe('on')
    expect(standing(2600, 2400)).toBe('on')
  })

  it('calls it under or over past that', () => {
    expect(standing(2000, 2400)).toBe('under')
    expect(standing(2800, 2400)).toBe('over')
  })

  it('says nothing when there is no target to compare with', () => {
    expect(standing(2400, 0)).toBe('none')
  })
})

describe('ingredient macros', () => {
  it('reads grams out of a weight quantity and nothing else', () => {
    expect(gramsOf('600 g')).toBe(600)
    expect(gramsOf('1.5 kg')).toBe(1500)
    expect(gramsOf('8 oz')).toBe(227)
    expect(gramsOf('1 lb')).toBe(454)
    expect(gramsOf('2 cloves')).toBeNull()
    expect(gramsOf('a splash')).toBeNull()
  })

  it('scales a per-100 g food to the grams used', () => {
    expect(forGrams({ kcal: 144, protein: 18.6, carbs: 0, fat: 7.92 }, 600)).toEqual({
      kcal: 864,
      protein: 111.6,
      carbs: 0,
      fat: 47.5,
    })
  })

  it('sums matched ingredients per serving and counts the unmatched', () => {
    const result = perServing(
      [
        { macros: { kcal: 864, protein: 111.6, carbs: 0, fat: 47.5 } },
        { macros: { kcal: 200, protein: 4, carbs: 40, fat: 1 } },
        { macros: null },
      ],
      4,
    )
    expect(result).toEqual({ macros: { kcal: 266, protein: 29, carbs: 10, fat: 12 }, matched: 2, of: 3 })
  })
})
