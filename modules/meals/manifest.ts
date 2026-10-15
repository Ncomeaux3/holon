import { z } from 'zod'
import { db } from '@/core/db'
import { get, normaliseUrl } from '@/core/fetching'
import { register } from '@/core/entities'
import { complete } from '@/core/llm'
import { recordError } from '@/core/log'
import { defineModule, defineTool } from '@/core/module-contract'
import { calendarFor } from './calendar'
import { fillWeek } from './fill'
import { nightlyDigest } from './jobs/nightly-digest'
import { importFailure, parseRecipe, type ParsedRecipe } from './jsonld'
import { fromModel, MODEL_SYSTEM, readRecipeText } from './text-recipe'
import MealsPage from './ui/MealsPage'
import { MealsTile } from './ui/Tile'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
const slot = z.enum(['breakfast', 'lunch', 'dinner', 'snack'])

// For the grams used, not per 100 g. Null when the ingredient has no USDA match.
const amount = z.number().min(0).max(100_000).nullable().optional()
const ingredient = z.object({
  item: z.string().min(1).max(200),
  quantity: z.string().max(80),
  fdc_id: z.number().int().positive().nullable().optional(),
  grams: z.number().positive().max(100_000).nullable().optional(),
  kcal: amount,
  protein_g: amount,
  carbs_g: amount,
  fat_g: amount,
})
type Ingredient = z.infer<typeof ingredient>

export default defineModule({
  id: 'meals',
  nav: { label: 'Meals', icon: 'utensils', order: 70 },
  pages: { '': MealsPage },

  tools: {
    get_digest: defineTool({
      description: 'What is planned, what was eaten, and how the week reads against its targets.',
      input: z.object({}),
      run: () => nightlyDigest(),
    }),

    write_recipe: defineTool({
      description:
        'Create or update a recipe. An imported one lands as a draft until the owner accepts it.',
      input: z.object({
        id: z.uuid().optional(),
        name: z.string().min(1).max(200).optional(),
        source_url: z.string().max(2000).optional(),
        notes: z.string().max(5000).optional(),
        servings: z.number().int().min(1).max(100).optional(),
        time_minutes: z.number().int().min(0).max(10_000).optional(),
        cost_cents: z.number().int().min(0).optional(),
        // Per serving, whole numbers. A tenth of a gram of fat is a precision
        // no recipe has.
        kcal: z.number().int().min(0).max(10_000).optional(),
        protein_g: z.number().int().min(0).max(1000).optional(),
        carbs_g: z.number().int().min(0).max(1000).optional(),
        fat_g: z.number().int().min(0).max(1000).optional(),
        tags: z.array(z.string().max(40)).max(20).optional(),
        favourite: z.boolean().optional(),
        ingredients: z.array(ingredient).max(100).optional(),
        steps: z.array(z.string().min(1).max(2000)).max(60).optional(),
      }),
      run: async (input, ctx) => {
        const { id, ingredients, steps, ...columns } = input

        if (id) {
          const fields = Object.entries(columns)
          if (fields.length > 0) {
            // Every key is a literal from the zod schema above, a closed set.
            const set = fields.map(([key], i) => `${key} = $${i + 2}`).join(', ')
            await db().query(`update meals.recipe set ${set} where id = $1`, [
              id,
              ...fields.map(([, value]) => value),
            ])
          }
          await writeParts(id, ingredients, steps)
          return { id }
        }

        if (!input.name) throw new Error('A recipe needs a name')

        // A parser reading someone's markup is proposing, not deciding. Same
        // shape as the Second Brain draft and the Travel booking inbox.
        const status = ctx.source === 'agent' ? 'draft' : 'ready'

        const { rows } = await db().query<{ id: string }>(
          `insert into meals.recipe
             (name, source_url, notes, servings, time_minutes, cost_cents,
              kcal, protein_g, carbs_g, fat_g, tags, favourite, status, source)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           returning id`,
          [
            input.name,
            input.source_url ?? '',
            input.notes ?? '',
            input.servings ?? 1,
            input.time_minutes ?? 0,
            input.cost_cents ?? 0,
            input.kcal ?? 0,
            input.protein_g ?? 0,
            input.carbs_g ?? 0,
            input.fat_g ?? 0,
            input.tags ?? [],
            input.favourite ?? false,
            status,
            ctx.source === 'agent' ? 'agent' : 'manual',
          ],
        )

        await writeParts(rows[0].id, ingredients, steps)

        await register({
          module: 'meals',
          entityType: 'recipe',
          entityId: rows[0].id,
          title: input.name,
          text: (input.tags ?? []).join(' '),
          // A draft is a proposal about a recipe, not a recipe, and earns
          // nothing until it is accepted.
          eventType: status === 'draft' ? 'meal_planned' : 'recipe_added',
        })

        return { id: rows[0].id, status }
      },
    }),

    import_recipe: defineTool({
      description:
        'Read the schema.org Recipe JSON-LD out of a page and file it as a draft for the owner to accept. The page is fetched through the checked fetch unless its source is passed as html; a page with no Recipe block is refused rather than guessed at, and the refusal names why (no JSON-LD, blocked, timeout, parse error) and is logged to the Errors tab.',
      input: z.object({ url: z.url(), html: z.string().min(1).optional() }),
      run: async ({ url, html }) => {
        // A post is behind Instagram's login, so a fetch reads a login page.
        // Said here, not logged: it is not a parser gap.
        if (/^https?:\/\/([a-z0-9-]+\.)?instagram\.com\//i.test(url)) {
          throw new Error('Instagram posts cannot be read. Open the post, copy the caption, and paste that instead.')
        }
        let recipe: ParsedRecipe
        let status: number | undefined
        try {
          const page = html ? { status: 200, body: html } : await get(normaliseUrl(url), { timeoutMs: 15_000 })
          status = page.status
          recipe = parseRecipe(page.body)
        } catch (error) {
          const failure = importFailure(error, status)
          // The Errors tab lists it under Meals for 90 days: that is where the
          // owner's failed URLs are collected to find the parser gaps.
          await recordError('meals/import_recipe', `${failure.reason}: ${url}`)
          throw new Error(failure.message)
        }
        const id = await insertDraft(recipe, { sourceUrl: url })
        return { id, status: 'draft', name: recipe.name }
      },
    }),

    parse_recipe_text: defineTool({
      description:
        'File pasted recipe text (a page copied by hand, an Instagram caption) as a draft. Rules read it first: the first line is the name, a line starting with a number and a unit is an ingredient, numbered lines are steps. Only when the rules do not find both ingredients and steps does one Haiku call read it, under the soft cap; over the cap or unconnected, the draft is the rules\' reading and says so.',
      input: z.object({ text: z.string().trim().min(1, 'Paste a recipe').max(20_000) }),
      run: async ({ text }) => {
        const read = readRecipeText(text)
        let recipe = read.recipe
        let classified: { by: 'rule' | 'model'; confidence: number } = { by: 'rule', confidence: 1 }
        let notes = ''

        if (!read.complete) {
          try {
            const reply = await complete({
              model: 'claude-haiku-4-5',
              purpose: 'recipe',
              module: 'meals',
              system: MODEL_SYSTEM,
              messages: [{ role: 'user', content: text }],
              maxTokens: 1500,
            })
            const model = fromModel(reply)
            if (model) {
              recipe = model.recipe
              classified = { by: 'model', confidence: model.confidence }
            } else {
              notes = 'The model found no recipe in the text, so this is what the rules could read.'
            }
          } catch (error) {
            // Not connected, over the cap, or the call failed: the rules'
            // reading is still a draft, and the note says it is incomplete.
            notes = `Read by rules only: ${error instanceof Error ? error.message : 'the model was not reached'}`
          }
          // A rules-only reading that missed ingredients or steps is a partial one.
          if (classified.by === 'rule') classified.confidence = 0.3
        }

        const id = await insertDraft(recipe, { notes, classified })
        return { id, status: 'draft', name: recipe.name, classified_by: classified.by }
      },
    }),

    fill_week: defineTool({
      description:
        'Fill the empty slots between two dates from the library: a recipe tagged for the slot, favourites first, rotating. No model. Nothing planned is replaced.',
      input: z.object({ from: date, to: date }),
      run: async ({ from, to }) => {
        const { rows: recipes } = await db().query<{ id: string; tags: string[]; favourite: boolean }>(
          `select id, tags, favourite from meals.recipe where status = 'ready'`,
        )
        const { rows: taken } = await db().query<{ on_date: string; slot: string }>(
          `select on_date::text, slot from meals.plan_entry where on_date between $1 and $2`,
          [from, to],
        )
        const { rows: days } = await db().query<{ on_date: string }>(
          `select d::date::text as on_date from generate_series($1::date, $2::date, '1 day') d`,
          [from, to],
        )
        const has = new Set(taken.map((t) => `${t.on_date}|${t.slot}`))
        const empty = days.flatMap((d) =>
          slot.options.filter((s) => !has.has(`${d.on_date}|${s}`)).map((s) => ({ on_date: d.on_date, slot: s })),
        )
        const picks = fillWeek(empty, recipes)
        for (const pick of picks) {
          await db().query(
            `insert into meals.plan_entry (recipe_id, on_date, slot) values ($1, $2, $3)
             on conflict (on_date, slot) do nothing`,
            [pick.recipe_id, pick.on_date, pick.slot],
          )
        }
        return { planned: picks.length }
      },
    }),

    accept_recipe: defineTool({
      description: 'Accept an imported recipe into the library, or discard it.',
      input: z.object({ id: z.uuid(), accept: z.boolean().default(true) }),
      run: async ({ id, accept }) => {
        if (!accept) {
          const { rowCount } = await db().query(`delete from meals.recipe where id = $1 and status = 'draft'`, [id])
          // A draft is registered at import; its registry row goes with it.
          if (rowCount) {
            await db().query(`delete from core.entities where module = 'meals' and entity_type = 'recipe' and entity_id = $1`, [id])
          }
          return { id, status: 'discarded' }
        }

        const { rows } = await db().query<{ name: string }>(
          `update meals.recipe set status = 'ready' where id = $1 returning name`,
          [id],
        )
        if (rows.length === 0) throw new Error(`No recipe ${id}`)

        await register({
          module: 'meals',
          entityType: 'recipe',
          entityId: id,
          title: rows[0].name,
          eventType: 'recipe_added',
        })

        return { id, status: 'ready' }
      },
    }),

    plan: defineTool({
      description: 'Put something in a slot on a day, or clear the slot by passing no recipe.',
      input: z.object({
        on_date: date,
        slot,
        recipe_id: z.uuid().nullable().optional(),
        label: z.string().max(200).optional(),
        servings: z.number().min(0.25).max(20).default(1),
      }),
      run: async (input) => {
        if (!input.recipe_id && !input.label) {
          await db().query(`delete from meals.plan_entry where on_date = $1 and slot = $2`, [
            input.on_date,
            input.slot,
          ])
          return { cleared: true }
        }

        const { rows } = await db().query<{ id: string }>(
          `insert into meals.plan_entry (recipe_id, label, on_date, slot, servings)
           values ($1, $2, $3, $4, $5)
           on conflict (on_date, slot) do update
             set recipe_id = excluded.recipe_id, label = excluded.label,
                 servings = excluded.servings
           returning id`,
          [
            input.recipe_id ?? null,
            input.label ?? '',
            input.on_date,
            input.slot,
            input.servings,
          ],
        )
        return { id: rows[0].id }
      },
    }),

    mark_eaten: defineTool({
      description: 'Tick a planned meal as eaten. A plan is not a log until this happens.',
      input: z.object({ id: z.uuid(), eaten: z.boolean().default(true) }),
      run: async ({ id, eaten }) => {
        const { rows } = await db().query<{ recipe_id: string | null; label: string }>(
          `update meals.plan_entry set eaten = $2 where id = $1
           returning recipe_id, label`,
          [id, eaten],
        )
        if (rows.length === 0) throw new Error(`No planned meal ${id}`)

        // Cooking is the work. Planning it is not, which is why only this
        // emits an event.
        if (eaten && rows[0].recipe_id) {
          await register({
            module: 'meals',
            entityType: 'recipe',
            entityId: rows[0].recipe_id,
            title: rows[0].label || 'A meal',
            eventType: 'meal_cooked',
          })
        }

        return { id, eaten }
      },
    }),
  },

  /**
   * Only parse_recipe_text, because it is the one tool here that can spend
   * money (one Haiku call). An imported recipe already lands as a draft,
   * which is this module's own version of the gate, and planning a meal is
   * reversible by planning a different one.
   */
  guarded: ['parse_recipe_text'],
  requires: [],
  calendar: calendarFor,

  metrics: {
    meals_cooked_this_week: {
      label: 'Meals cooked this week',
      unit: 'meals',
      get: async () => {
        const { rows } = await db().query<{ n: string }>(
          `select count(*)::text as n from meals.plan_entry
            where eaten and on_date >= core.today() - 7`,
        )
        return Number(rows[0].n)
      },
    },
  },

  /** See ModuleManifest.tile: the module says how its own numbers read. */
  tile: MealsTile,

  jobs: [{ name: 'nightly_digest', run: nightlyDigest }],
  entityHref: (t, id) => (t === 'recipe' ? `/meals?recipe=${id}` : null),
  entityTypes: ['recipe'],
})

/**
 * Ingredients and steps are cleared and rewritten rather than diffed.
 *
 * They are an ordered list owned entirely by the recipe, nothing outside points
 * at a row, and a diff would be more code for the same result.
 */
async function writeParts(
  recipeId: string,
  ingredients?: Ingredient[],
  steps?: string[],
): Promise<void> {
  if (ingredients) {
    await db().query(`delete from meals.ingredient where recipe_id = $1`, [recipeId])
    for (const [position, i] of ingredients.entries()) {
      await db().query(
        `insert into meals.ingredient
           (recipe_id, item, quantity, position, fdc_id, grams, kcal, protein_g, carbs_g, fat_g)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [recipeId, i.item, i.quantity, position, i.fdc_id ?? null, i.grams ?? null, i.kcal ?? null, i.protein_g ?? null, i.carbs_g ?? null, i.fat_g ?? null],
      )
    }
  }

  if (steps) {
    await db().query(`delete from meals.step where recipe_id = $1`, [recipeId])
    for (const [position, instruction] of steps.entries()) {
      await db().query(
        `insert into meals.step (recipe_id, instruction, position) values ($1, $2, $3)`,
        [recipeId, instruction, position],
      )
    }
  }
}

/**
 * A recipe a reader proposed, filed as a draft and registered. Both readers
 * (a page's JSON-LD, pasted text) land here; a draft earns nothing until it is
 * accepted, hence `meal_planned` (weight 0).
 */
async function insertDraft(
  recipe: ParsedRecipe,
  extra: { sourceUrl?: string; notes?: string; classified?: { by: 'rule' | 'model'; confidence: number } },
): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into meals.recipe
       (name, source_url, notes, servings, time_minutes, kcal, protein_g, carbs_g, fat_g,
        status, classified_by, confidence)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10, $11)
     returning id`,
    [
      recipe.name.slice(0, 200),
      extra.sourceUrl ?? '',
      extra.notes ?? '',
      recipe.servings,
      recipe.time_minutes,
      recipe.kcal,
      recipe.protein_g,
      recipe.carbs_g,
      recipe.fat_g,
      extra.classified?.by ?? null,
      extra.classified?.confidence ?? null,
    ],
  )
  // The same bounds as write_recipe, so a draft from a long page or a pasted
  // paragraph can still be opened in the form and saved.
  await writeParts(
    rows[0].id,
    recipe.ingredients.slice(0, 100).map((i) => ({ item: i.item.slice(0, 200), quantity: i.quantity.slice(0, 80) })),
    recipe.steps.slice(0, 60).map((step) => step.slice(0, 2000)),
  )
  await register({
    module: 'meals',
    entityType: 'recipe',
    entityId: rows[0].id,
    title: recipe.name,
    eventType: 'meal_planned',
  })
  return rows[0].id
}
