// Macro arithmetic. No imports: the Meals screen is a
// client component and anything reaching core/db.ts drags pg into the browser
// bundle.

export type Macros = { kcal: number; protein: number; carbs: number; fat: number }

export const ZERO: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 }

export type PlannedMeal = {
  servings: number
  eaten: boolean
  /** Per serving. Null for something eaten with no recipe behind it. */
  macros: Macros | null
}

/**
 * Sum a day or a week.
 *
 * `eatenOnly` is the whole reason this takes a flag rather than being two
 * functions: planned and eaten are different questions asked of the same rows,
 * and the screen shows both side by side. A plan is an intention; a log is what
 * happened, and conflating them makes both useless.
 *
 * A meal with no recipe contributes nothing rather than being guessed at. The
 * screen says how many of those there were, so a low total is visibly
 * incomplete rather than quietly wrong.
 */
export function total(meals: PlannedMeal[], eatenOnly = false): Macros & { unknown: number } {
  let unknown = 0

  const sum = meals.reduce((acc, meal) => {
    if (eatenOnly && !meal.eaten) return acc
    if (!meal.macros) {
      unknown++
      return acc
    }
    return {
      kcal: acc.kcal + meal.macros.kcal * meal.servings,
      protein: acc.protein + meal.macros.protein * meal.servings,
      carbs: acc.carbs + meal.macros.carbs * meal.servings,
      fat: acc.fat + meal.macros.fat * meal.servings,
    }
  }, ZERO)

  return {
    kcal: Math.round(sum.kcal),
    protein: Math.round(sum.protein),
    carbs: Math.round(sum.carbs),
    fat: Math.round(sum.fat),
    unknown,
  }
}

/**
 * How a total reads against a target.
 *
 * Under, on, or over, with a tolerance either side, because hitting a calorie
 * target to the calorie is not a thing that happens and a screen that demanded
 * it would be red every day.
 */
export type Standing = 'under' | 'on' | 'over' | 'none'

const TOLERANCE = 0.1

export function standing(actual: number, target: number): Standing {
  if (target <= 0) return 'none'
  const ratio = actual / target
  if (ratio < 1 - TOLERANCE) return 'under'
  if (ratio > 1 + TOLERANCE) return 'over'
  return 'on'
}

const GRAMS_PER: Record<string, number> = { g: 1, gram: 1, grams: 1, kg: 1000, oz: 28.3495, lb: 453.592, lbs: 453.592 }

/**
 * "600 g" is 600 and "8 oz" is 227. Null for anything that is not a weight:
 * "2 cloves" has no honest gram figure, and the form asks rather than guessing.
 */
export function gramsOf(quantity: string): number | null {
  const m = quantity.trim().match(/^(\d+(?:\.\d+)?)\s*([a-z]+)\.?$/i)
  const per = m ? GRAMS_PER[m[2].toLowerCase()] : undefined
  return m && per ? Math.round(Number(m[1]) * per) : null
}

const tenth = (n: number) => Math.round(n * 10) / 10

/** A USDA food's per-100 g macros for the grams a recipe uses, to a tenth. */
export function forGrams(per100: Macros, grams: number): Macros {
  const f = grams / 100
  return {
    kcal: Math.round(per100.kcal * f),
    protein: tenth(per100.protein * f),
    carbs: tenth(per100.carbs * f),
    fat: tenth(per100.fat * f),
  }
}

/**
 * The recipe's per-serving macros from its matched ingredients, whole numbers
 * as the recipe columns hold them. `matched` of `of` is shown beside the total,
 * so an unmatched ingredient reads as a gap rather than as zero calories.
 */
export function perServing(
  ingredients: { macros: Macros | null }[],
  servings: number,
): { macros: Macros; matched: number; of: number } {
  const known = ingredients.flatMap((i) => (i.macros ? [i.macros] : []))
  const sum = (key: keyof Macros) => Math.round(known.reduce((a, m) => a + m[key], 0) / Math.max(1, servings))
  return {
    macros: { kcal: sum('kcal'), protein: sum('protein'), carbs: sum('carbs'), fat: sum('fat') },
    matched: known.length,
    of: ingredients.length,
  }
}
