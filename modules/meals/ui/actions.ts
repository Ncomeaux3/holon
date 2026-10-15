'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
import { callTool, ToolInputError } from '@/core/tools'

// Server actions are standalone POST endpoints addressed by id, so the (app)
// layout does not run for them and each one authenticates independently.

export type ActionResult = { ok: true } | { ok: false; error: string; fields?: Record<string, string> }

function failed(error: unknown): ActionResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : 'Failed',
    ...(error instanceof ToolInputError && { fields: error.fields }),
  }
}

function done(): ActionResult {
  revalidatePath('/meals')
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function planMeal(
  onDate: string,
  slot: 'breakfast' | 'lunch' | 'dinner' | 'snack',
  recipeId: string | null,
): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool(
      'meals',
      'plan',
      { on_date: onDate, slot, recipe_id: recipeId },
      { source: 'ui' },
    )
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function markEaten(id: string, eaten: boolean): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('meals', 'mark_eaten', { id, eaten }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function decideRecipe(id: string, accept: boolean): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('meals', 'accept_recipe', { id, accept }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function setFavourite(id: string, favourite: boolean): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('meals', 'write_recipe', { id, favourite }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function fillWeek(from: string, to: string): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('meals', 'fill_week', { from, to }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

/** Something eaten with no recipe behind it: a label in a slot, ticked. */
export async function logAdhoc(
  onDate: string,
  slot: 'breakfast' | 'lunch' | 'dinner' | 'snack',
  label: string,
): Promise<ActionResult> {
  await requireOwner()
  try {
    const planned = await callTool('meals', 'plan', { on_date: onDate, slot, label }, { source: 'ui' })
    if (planned.status !== 'done') return failed(new Error('Not planned'))
    const { id } = planned.result as { id: string }
    await callTool('meals', 'mark_eaten', { id, eaten: true }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

/** Read a page's Recipe JSON-LD into a draft. The tool's refusal is the error. */
export async function importRecipe(
  url: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string; fields?: Record<string, string> }> {
  await requireOwner()
  try {
    const result = await callTool('meals', 'import_recipe', { url }, { source: 'ui' })
    if (result.status !== 'done') return { ok: false, error: 'Not imported' }
    revalidatePath('/meals')
    return { ok: true, id: (result.result as { id: string }).id }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' }
  }
}

export type RecipeInput = {
  id?: string
  name: string
  servings: number
  time_minutes: number
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  tags: string[]
  notes: string
  ingredients: {
    item: string
    quantity: string
    fdc_id: number | null
    grams: number | null
    kcal: number | null
    protein_g: number | null
    carbs_g: number | null
    fat_g: number | null
  }[]
  steps: string[]
}

/** New recipe and Edit: one form over write_recipe. A typed recipe is ready, not a draft. */
export async function saveRecipe(
  input: RecipeInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string; fields?: Record<string, string> }> {
  await requireOwner()
  try {
    const result = await callTool('meals', 'write_recipe', input, { source: 'ui' })
    if (result.status !== 'done') return { ok: false, error: 'Not saved' }
    done()
    return { ok: true, id: (result.result as { id: string }).id }
  } catch (error) {
    return failed(error) as { ok: false; error: string; fields?: Record<string, string> }
  }
}

/** Pasted text to a draft: rules first, one Haiku call only for what they miss. */
export async function pasteRecipe(
  text: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string; fields?: Record<string, string> }> {
  await requireOwner()
  try {
    const result = await callTool('meals', 'parse_recipe_text', { text }, { source: 'ui' })
    if (result.status !== 'done') return { ok: false, error: 'Not read' }
    done()
    return { ok: true, id: (result.result as { id: string }).id }
  } catch (error) {
    return failed(error) as { ok: false; error: string; fields?: Record<string, string> }
  }
}
