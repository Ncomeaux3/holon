import { readMetric } from '@/core/metrics'
import { getSkillNames } from '@/core/modules'
import { listSkillLinks } from '@/core/skill-links'
import { startOfWeek } from '@/core/clock'
import { getSetting } from '@/core/settings'
import { ownerToday } from '@/core/today'
import { listPlan, listRecipes, recipeDetail } from '../data'
import { Meals, type MealsData } from './Meals'

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

export default async function MealsPage() {
  const [todayIso, weekStart] = await Promise.all([ownerToday(), getSetting('week_start')])
  const first = startOfWeek(todayIso, weekStart)

  const [recipes, plan, bodyWeight, links, names] = await Promise.all([
    listRecipes(),
    // Four weeks either side of this one. The stepper pages further, into an
    // empty grid that "+" still plans into.
    // ponytail: a fixed window; page the query by ?week= if the plan ever
    // matters that far out.
    listPlan(addDays(first, -28), 63),
    // A calorie target is a Fitness concern. Read through the registry so
    // there is one source of truth, and absent rather than invented when that
    // module is not installed.
    readMetric('fitness.body_weight'),
    listSkillLinks('meals', 'recipe'),
    getSkillNames(),
  ])

  const detail = await recipeDetail(recipes.map((r) => r.id))

  const data: MealsData = {
    todayIso,
    weekStart,
    // Fifteen calories a pound, the crude maintenance rule of thumb. Labelled
    // an estimate wherever it is shown, because that is what it is.
    kcalTarget: bodyWeight === null || bodyWeight <= 0 ? null : Math.round(bodyWeight * 15),
    recipes: recipes.map((r) => ({
      id: r.id,
      name: r.name,
      sourceUrl: r.source_url,
      notes: r.notes,
      servings: r.servings,
      timeMinutes: r.time_minutes,
      costCents: r.cost_cents,
      macros: { kcal: r.kcal, protein: r.protein_g, carbs: r.carbs_g, fat: r.fat_g },
      tags: r.tags,
      favourite: r.favourite,
      status: r.status,
      ingredients: detail.get(r.id)?.ingredients ?? [],
      steps: detail.get(r.id)?.steps ?? [],
      classifiedBy: r.classified_by,
      confidence: r.confidence === null ? null : Number(r.confidence),
      entityRef: links.get(r.id)?.entityRef ?? null,
      skills: links.get(r.id)?.skills ?? [],
    })),
    plan: plan.map((p) => ({
      id: p.id,
      recipeId: p.recipe_id,
      label: p.recipe_name ?? p.label,
      onDate: p.on_date,
      slot: p.slot,
      servings: Number(p.servings),
      eaten: p.eaten,
      macros:
        p.kcal === null
          ? null
          : {
              kcal: p.kcal,
              protein: p.protein_g ?? 0,
              carbs: p.carbs_g ?? 0,
              fat: p.fat_g ?? 0,
            },
    })),
    skills: Object.entries(names),
  }

  return <Meals data={data} />
}
