import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const complete = vi.fn()
vi.mock('@/core/llm', async () => {
  const actual = await vi.importActual<typeof import('@/core/llm')>('@/core/llm')
  return { ...actual, complete: (...args: unknown[]) => complete(...args) }
})

const { db } = await import('@/core/db')
const { SoftCapExceeded } = await import('@/core/llm')
// The registry first: register() reads it, and importing the manifest alone
// would leave it half built behind the import cycle.
await import('@/core/modules')
const { default: meals } = await import('./manifest')

const ui = { source: 'ui' as const }
const recipeCalls = () => complete.mock.calls.filter(([args]) => (args as { purpose?: string } | undefined)?.purpose === 'recipe')

async function draft(id: string) {
  const { rows } = await db().query<{ name: string; status: string; classified_by: string; confidence: string; notes: string }>(
    `select name, status, classified_by, confidence::text, notes from meals.recipe where id = $1`,
    [id],
  )
  const { rows: parts } = await db().query<{ item: string }>(
    `select item from meals.ingredient where recipe_id = $1 order by position`,
    [id],
  )
  return { ...rows[0], items: parts.map((p) => p.item) }
}

beforeEach(() => complete.mockReset())
afterEach(async () => {
  await db().query('delete from meals.recipe')
  // register() leaves entities, events and links; another file's classifier
  // test counts parked entities, so none may outlive this one.
  await db().query(`delete from core.skill_links where entity_ref in (select id from core.entities where module = 'meals')`)
  await db().query(`delete from core.events where module = 'meals'`)
  await db().query(`delete from core.entities where module = 'meals'`)
  await db().query(`delete from core.request_log where route = 'meals/import_recipe'`)
})
afterAll(async () => {
  await db().end()
})

describe('parse_recipe_text', () => {
  it('files a draft by rules alone when they find ingredients and steps, with no model call', async () => {
    const { id } = (await meals.tools.parse_recipe_text.run({ text: 'Toast\n2 slices bread\n1. Grill 2 minutes.' }, ui)) as { id: string }
    expect(await draft(id)).toMatchObject({ name: 'Toast', status: 'draft', classified_by: 'rule', confidence: '1.00', items: ['bread'] })
    expect(recipeCalls()).toHaveLength(0)
  })

  it('asks the model once for what the rules could not place, and stores its confidence', async () => {
    complete.mockResolvedValue('{"name":"Pasta","servings":2,"ingredients":["200 g spaghetti"],"steps":["Boil it."],"confidence":0.7}')
    const { id } = (await meals.tools.parse_recipe_text.run({ text: 'Best pasta ever\nToss it all and enjoy #pasta' }, ui)) as { id: string }
    expect(recipeCalls()).toHaveLength(1)
    expect(await draft(id)).toMatchObject({ name: 'Pasta', classified_by: 'model', confidence: '0.70', items: ['spaghetti'] })
  })

  it('over the cap, still files the rules reading as a draft and says why it is partial', async () => {
    // Only the recipe call: skill classification on register is not capped.
    complete.mockImplementation(async (args?: { purpose?: string }) => {
      if (args?.purpose === 'recipe') throw new SoftCapExceeded(1100, 1000)
      return ''
    })
    const { id } = (await meals.tools.parse_recipe_text.run({ text: 'Best pasta ever\n200 g spaghetti' }, ui)) as { id: string }
    const row = await draft(id)
    expect(row).toMatchObject({ name: 'Best pasta ever', classified_by: 'rule', confidence: '0.30', items: ['spaghetti'] })
    expect(row.notes).toMatch(/^Read by rules only: Model spend this month/)
  })
})

describe('import_recipe', () => {
  it('refuses a page with no JSON-LD, says why, and logs it to the Errors tab', async () => {
    await expect(
      meals.tools.import_recipe.run({ url: 'https://example.com/soup', html: '<html><body>Soup</body></html>' }, ui),
    ).rejects.toThrow('That page has no recipe data a reader can use. Paste the recipe instead.')
    const { rows } = await db().query<{ error: string }>(`select error from core.request_log where route = 'meals/import_recipe'`)
    expect(rows.map((r) => r.error)).toEqual(['no JSON-LD: https://example.com/soup'])
  })
})

describe('import_recipe and Instagram', () => {
  it('refuses an Instagram post before fetching it, and logs nothing', async () => {
    await expect(meals.tools.import_recipe.run({ url: 'https://www.instagram.com/p/abc123/' }, ui)).rejects.toThrow(/copy the caption/)
    const { rows } = await db().query(`select 1 from core.request_log where route = 'meals/import_recipe'`)
    expect(rows).toHaveLength(0)
  })
})

describe('write_recipe', () => {
  it('saves a typed recipe as ready with its USDA match on the ingredient', async () => {
    const { id, status } = (await meals.tools.write_recipe.run(
      {
        name: 'Thighs',
        servings: 2,
        kcal: 432,
        ingredients: [{ item: 'chicken thigh', quantity: '600 g', fdc_id: 2646171, grams: 600, kcal: 864, protein_g: 111.6, carbs_g: 0, fat_g: 47.5 }],
        steps: ['Roast.'],
      },
      ui,
    )) as { id: string; status: string }
    expect(status).toBe('ready')
    const { rows } = await db().query<{ fdc_id: number; grams: string; kcal: string }>(
      `select fdc_id, grams::text, kcal::text from meals.ingredient where recipe_id = $1`,
      [id],
    )
    expect(rows).toEqual([{ fdc_id: 2646171, grams: '600', kcal: '864' }])
  })
})
