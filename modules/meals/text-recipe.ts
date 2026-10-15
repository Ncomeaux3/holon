// A recipe out of pasted text: a page copied by hand, or an Instagram caption.
// Rules first. The model reads the text only when the rules could not find
// both ingredients and steps; see parse_recipe_text in ./manifest.ts.
//
// No imports beyond ./jsonld, which has none: this is tested without a database.

import { COUNT, UNITS, splitIngredient, text, type ParsedRecipe } from './jsonld'

export type TextRead = {
  recipe: ParsedRecipe
  /** Lines no rule placed: prose, hashtags, a heading the rules do not know. */
  rest: string[]
  /** Both ingredients and steps were found, so nothing is left for a model. */
  complete: boolean
}

const BULLET = /^[-*•·–]\s*/
// The lookahead keeps "1.5 cups flour" an ingredient rather than step "5 cups flour".
const NUMBERED = /^(?:step\s*)?\d+\s*[.):](?!\d)\s*/i
const INGREDIENTS = /^ingredients?:?$/i
const STEPS = /^(method|directions?|instructions?|steps?|preparation):?$/i
const SERVES = /^(?:serves|servings?|makes|yield)\s*:?\s*(\d+)/i
const TIME = /\b(time|ready in|takes)\b/i

/** "1 hr 30 min" is 90. 0 when the line names no hours or minutes. */
function minutesIn(line: string): number {
  const hours = line.match(/(\d+)\s*(h|hr|hrs|hour|hours)\b/i)
  const mins = line.match(/(\d+)\s*(m|min|mins|minute|minutes)\b/i)
  return Number(hours?.[1] ?? 0) * 60 + Number(mins?.[1] ?? 0)
}

/** "2 cans beans" and "½ cup milk": a number, then a unit. "2 eggs" needs a heading. */
function looksLikeIngredient(line: string): boolean {
  const [first, second] = line.split(' ')
  return COUNT.test(first ?? '') && UNITS.test(second ?? '')
}

export function readRecipeText(input: string): TextRead {
  const lines = input
    .split(/\r?\n/)
    .map((l) => text(l))
    .filter(Boolean)

  const recipe: ParsedRecipe = {
    name: '',
    servings: 1,
    time_minutes: 0,
    kcal: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    ingredients: [],
    steps: [],
  }
  const rest: string[] = []
  let section: 'ingredients' | 'steps' | null = null

  // The first line names the recipe unless it is already a heading, as in a
  // paste that opens "Ingredients:"; then the draft says it needs a name.
  const heading = (l: string) => INGREDIENTS.test(l) || STEPS.test(l)
  recipe.name = lines[0] && !heading(lines[0]) ? lines.shift()! : 'Pasted recipe'

  for (const raw of lines) {
    if (INGREDIENTS.test(raw)) {
      section = 'ingredients'
      continue
    }
    if (STEPS.test(raw)) {
      section = 'steps'
      continue
    }
    const line = raw.replace(BULLET, '')
    // A step that says "makes 12" or "rest 10 min" is a step, not the yield
    // or the time.
    const inSteps = section === 'steps' || NUMBERED.test(line)

    const serves = raw.match(SERVES)
    if (serves && !inSteps) {
      recipe.servings = Math.max(1, Number(serves[1]))
      continue
    }
    if (!inSteps && TIME.test(raw) && minutesIn(raw) > 0 && raw.length < 60) {
      recipe.time_minutes = minutesIn(raw)
      continue
    }

    if (NUMBERED.test(line)) {
      recipe.steps.push(line.replace(NUMBERED, ''))
    } else if (section === 'ingredients' || looksLikeIngredient(line)) {
      recipe.ingredients.push(splitIngredient(line))
    } else if (section === 'steps') {
      recipe.steps.push(line)
    } else {
      rest.push(raw)
    }
  }

  return { recipe, rest, complete: recipe.ingredients.length > 0 && recipe.steps.length > 0 }
}

/** What the model is asked for. One call, Haiku, under the capped `recipe` purpose. */
export const MODEL_SYSTEM = `You read a recipe out of pasted text, often a social media caption.
Reply with one JSON object and nothing else:
{"name": string, "servings": integer, "time_minutes": integer, "ingredients": [string], "steps": [string], "confidence": number}
Each ingredient is one line as a cook would write it, quantity first ("200 g spaghetti").
Each step is one instruction. Use only what the text says: never invent an ingredient, a quantity, a step or a time. Use 0 for a time the text does not give and 1 for servings it does not give.
confidence is 0 to 1: how sure you are this is a complete, correctly split recipe.`

/** The model's reply as a recipe, or null when it holds none. */
export function fromModel(reply: string): { recipe: ParsedRecipe; confidence: number } | null {
  const json = reply.match(/\{[\s\S]*\}/)
  if (!json) return null
  let data: Record<string, unknown>
  try {
    data = JSON.parse(json[0])
  } catch {
    return null
  }

  const strings = (v: unknown) => (Array.isArray(v) ? v.map((s) => text(s)).filter(Boolean) : [])
  const whole = (v: unknown, min: number) => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) && n >= min ? n : min
  }

  const name = text(data.name)
  const ingredients = strings(data.ingredients).map(splitIngredient)
  const steps = strings(data.steps)
  if (!name || (ingredients.length === 0 && steps.length === 0)) return null

  const confidence = Number(data.confidence)
  return {
    recipe: {
      name: name.slice(0, 200),
      servings: Math.min(100, whole(data.servings, 1)),
      time_minutes: whole(data.time_minutes, 0),
      kcal: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      ingredients,
      steps,
    },
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5,
  }
}
