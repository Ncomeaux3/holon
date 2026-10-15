import { db } from '@/core/db'

// Reads for the screen and the digest. The macro arithmetic lives in
// ./macros.ts, which has no imports and can be pulled into a client.

export type RecipeRow = {
  id: string
  name: string
  source_url: string
  notes: string
  servings: number
  time_minutes: number
  cost_cents: number
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  tags: string[]
  favourite: boolean
  status: string
  classified_by: string | null
  confidence: string | null
}

export async function listRecipes(): Promise<RecipeRow[]> {
  const { rows } = await db().query<RecipeRow>(
    `select id, name, source_url, notes, servings, time_minutes, cost_cents,
            kcal, protein_g, carbs_g, fat_g, tags, favourite, status, classified_by, confidence::text
       from meals.recipe
      order by status, favourite desc, name`,
  )
  return rows
}

export type PlanRow = {
  id: string
  recipe_id: string | null
  label: string
  on_date: string
  slot: string
  servings: string
  eaten: boolean
  recipe_name: string | null
  kcal: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
}

/** The plan for a window of days, with each entry's recipe macros attached. */
export async function listPlan(fromIso: string, days = 7): Promise<PlanRow[]> {
  const { rows } = await db().query<PlanRow>(
    `select p.id, p.recipe_id, p.label, p.on_date::text, p.slot, p.servings::text, p.eaten,
            r.name as recipe_name, r.kcal, r.protein_g, r.carbs_g, r.fat_g
       from meals.plan_entry p
       left join meals.recipe r on r.id = p.recipe_id
      where p.on_date >= $1::date and p.on_date < $1::date + $2::int
      order by p.on_date, p.slot`,
    [fromIso, days],
  )
  return rows
}

/** An ingredient row, with its USDA match when it has one. Macros are for `grams`. */
export type IngredientRow = {
  item: string
  quantity: string
  fdcId: number | null
  grams: number | null
  macros: { kcal: number; protein: number; carbs: number; fat: number } | null
}

export async function recipeDetail(
  ids: string[],
): Promise<Map<string, { ingredients: IngredientRow[]; steps: string[] }>> {
  const detail = new Map<string, { ingredients: IngredientRow[]; steps: string[] }>()
  if (ids.length === 0) return detail

  const { rows: ingredients } = await db().query<{
    recipe_id: string
    item: string
    quantity: string
    fdc_id: number | null
    grams: string | null
    kcal: string | null
    protein_g: string | null
    carbs_g: string | null
    fat_g: string | null
  }>(
    `select recipe_id, item, quantity, fdc_id, grams::text, kcal::text, protein_g::text, carbs_g::text, fat_g::text
       from meals.ingredient
      where recipe_id = any($1) order by position`,
    [ids],
  )

  const { rows: steps } = await db().query<{ recipe_id: string; instruction: string }>(
    `select recipe_id, instruction from meals.step
      where recipe_id = any($1) order by position`,
    [ids],
  )

  for (const id of ids) {
    detail.set(id, {
      ingredients: ingredients
        .filter((i) => i.recipe_id === id)
        .map((i) => ({
          item: i.item,
          quantity: i.quantity,
          fdcId: i.fdc_id,
          grams: i.grams === null ? null : Number(i.grams),
          macros:
            i.kcal === null
              ? null
              : { kcal: Number(i.kcal), protein: Number(i.protein_g ?? 0), carbs: Number(i.carbs_g ?? 0), fat: Number(i.fat_g ?? 0) },
        })),
      steps: steps.filter((s) => s.recipe_id === id).map((s) => s.instruction),
    })
  }

  return detail
}
