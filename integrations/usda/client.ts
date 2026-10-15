import { getCredentials } from '@/core/credentials'

// USDA FoodData Central, foods/search. Verified 2026-10-14 against
// fdc.nal.usda.gov/api-guide and live calls: GET with `query`, `pageSize`,
// `dataType` and `api_key`; nutrients come back as `foodNutrients[]` with
// `nutrientId` and `value`, per 100 g for every data type (a Branded
// yogurt's 150 g container read 8.67 g protein, its label's 13 g / 1.5).
// 1,000 requests an hour per key; a bad key is a 403.

const SEARCH = 'https://api.nal.usda.gov/fdc/v1/foods/search'

/**
 * Foundation and SR Legacy only: the raw ingredients a recipe names. With
 * every type, "rolled oats" returned five Branded copies of rolled oats and no
 * generic one.
 */
const DATA_TYPES = 'Foundation,SR Legacy'

/** Per 100 g. Declared here so the integration stands without the Meals module. */
export type Macros = { kcal: number; protein: number; carbs: number; fat: number }

export type Food = { fdcId: number; description: string; dataType: string; per100: Macros }

type Nutrient = { nutrientId?: number; value?: number }

/**
 * Energy is 1008 in SR Legacy, but Foundation foods report it only as 2047
 * (Atwater general) or 2048 (Atwater specific), so the first present wins.
 * Protein 1003, fat 1004, carbohydrate by difference 1005, which a Foundation
 * food can report a hair below zero: floored.
 */
export function per100(nutrients: Nutrient[]): Macros {
  const value = (...ids: number[]) => {
    for (const id of ids) {
      const n = nutrients.find((x) => x.nutrientId === id)
      if (typeof n?.value === 'number') return Math.max(0, n.value)
    }
    return 0
  }
  return { kcal: value(1008, 2047, 2048), protein: value(1003), carbs: value(1005), fat: value(1004) }
}

export class UsdaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'UsdaError'
  }
}

export async function searchFoods(query: string, apiKey?: string): Promise<Food[]> {
  const key = apiKey ?? (await getCredentials('usda'))?.api_key
  if (!key) throw new UsdaError('USDA FoodData Central is not connected. Add a key in Settings, Connections.', 0)

  const url = `${SEARCH}?${new URLSearchParams({ query, pageSize: '5', dataType: DATA_TYPES })}`
  let res: Response
  try {
    res = await fetch(url, { headers: { 'X-Api-Key': key }, signal: AbortSignal.timeout(8_000) })
  } catch {
    throw new UsdaError('USDA did not answer.', 0)
  }
  if (!res.ok) {
    throw new UsdaError(
      res.status === 403 ? 'USDA refused the key.' : res.status === 429 ? 'USDA rate limit reached, try again in an hour.' : `USDA search failed: ${res.status}`,
      res.status,
    )
  }
  const body = (await res.json()) as { foods?: { fdcId: number; description: string; dataType: string; foodNutrients?: Nutrient[] }[] }
  return (body.foods ?? []).map((f) => ({
    fdcId: f.fdcId,
    description: f.description,
    dataType: f.dataType,
    per100: per100(f.foodNutrients ?? []),
  }))
}
