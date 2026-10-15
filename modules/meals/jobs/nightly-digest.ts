import { db } from '@/core/db'
import { readMetric } from '@/core/metrics'
import { listPlan } from '../data'
import { standing, total } from '../macros'

export type MealsDigest = {
  plannedThisWeek: number
  eatenThisWeek: number
  /** Slots in the next seven days with nothing in them. */
  gaps: number
  kcalPlanned: number
  kcalEaten: number
  /** Against the Fitness target when that module is installed, else null. */
  kcalTarget: number | null
  kcalStanding: string
  /** Meals eaten with no recipe behind them, so a low total reads as incomplete. */
  unknown: number
}

export async function nightlyDigest(): Promise<MealsDigest> {
  const { rows: todayRows } = await db().query<{ today: string }>(
    `select core.today()::text as today`,
  )
  const plan = await listPlan(todayRows[0].today, 7)

  const meals = plan.map((p) => ({
    servings: Number(p.servings),
    eaten: p.eaten,
    macros:
      p.kcal === null
        ? null
        : { kcal: p.kcal, protein: p.protein_g ?? 0, carbs: p.carbs_g ?? 0, fat: p.fat_g ?? 0 },
  }))

  const planned = total(meals)
  const eaten = total(meals, true)

  // A calorie target is a Fitness concern, not a Meals one. Read through the
  // registry so there is one source of truth, and simply absent when that
  // module is not installed rather than a number invented here.
  const bodyWeight = await readMetric('fitness.body_weight')
  // Fifteen calories a pound is the crude maintenance rule of thumb. Labelled
  // as an estimate wherever it is shown, because it is one.
  const target = bodyWeight === null || bodyWeight <= 0 ? null : Math.round(bodyWeight * 15)

  return {
    plannedThisWeek: plan.length,
    eatenThisWeek: plan.filter((p) => p.eaten).length,
    // Four slots a day for seven days.
    gaps: 28 - plan.length,
    kcalPlanned: planned.kcal,
    kcalEaten: eaten.kcal,
    kcalTarget: target === null ? null : target * 7,
    kcalStanding: target === null ? 'none' : standing(planned.kcal, target * 7),
    unknown: planned.unknown,
  }
}
