import { describe, expect, it } from 'vitest'
import { importFailure, NoRecipe, parseRecipe, splitIngredient } from './jsonld'

const page = (json: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(json)}</script></head><body>x</body></html>`

describe('parseRecipe', () => {
  it('reads a Recipe out of a @graph, with steps, yield, time and nutrition', () => {
    const html = page({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', name: 'Turkey chili' },
        {
          '@type': ['Recipe'],
          name: 'Turkey chili',
          recipeYield: '6 servings',
          totalTime: 'PT45M',
          recipeIngredient: ['900 g ground turkey', '2 cans kidney beans', 'Salt'],
          recipeInstructions: [
            { '@type': 'HowToStep', text: 'Brown the turkey.' },
            {
              '@type': 'HowToSection',
              name: 'Then',
              itemListElement: [{ '@type': 'HowToStep', text: 'Simmer <b>30</b> min.' }],
            },
          ],
          nutrition: {
            '@type': 'NutritionInformation',
            calories: '540 calories',
            proteinContent: '44 g',
            carbohydrateContent: '46g',
            fatContent: '14.4 g',
          },
        },
      ],
    })

    expect(parseRecipe(html)).toEqual({
      name: 'Turkey chili',
      servings: 6,
      time_minutes: 45,
      kcal: 540,
      protein_g: 44,
      carbs_g: 46,
      fat_g: 14,
      ingredients: [
        { item: 'ground turkey', quantity: '900 g' },
        { item: 'kidney beans', quantity: '2 cans' },
        { item: 'Salt', quantity: '' },
      ],
      steps: ['Brown the turkey.', 'Simmer 30 min.'],
    })
  })

  it('takes plain string steps, a numeric yield, and prep plus cook when there is no total', () => {
    const html = page({
      '@type': 'Recipe',
      name: 'Oats',
      recipeYield: 1,
      prepTime: 'PT5M',
      cookTime: 'PT1H',
      recipeIngredient: ['80 g rolled oats'],
      recipeInstructions: 'Mix. Wait.',
    })
    const recipe = parseRecipe(html)
    expect(recipe.servings).toBe(1)
    expect(recipe.time_minutes).toBe(65)
    expect(recipe.steps).toEqual(['Mix. Wait.'])
    expect(recipe.kcal).toBe(0)
  })

  it('says so when the page has no Recipe rather than guessing', () => {
    expect(() => parseRecipe(page({ '@type': 'Article', name: 'x' }))).toThrow(NoRecipe)
    expect(() => parseRecipe('<html><body>nothing</body></html>')).toThrow(NoRecipe)
    expect(() => parseRecipe(page({ '@type': 'Recipe' }))).toThrow(NoRecipe)
  })
})

describe('splitIngredient', () => {
  it('splits the leading count and unit from the thing you buy', () => {
    expect(splitIngredient('600 g chicken thigh')).toEqual({ quantity: '600 g', item: 'chicken thigh' })
    expect(splitIngredient('1/2 avocado')).toEqual({ quantity: '1/2', item: 'avocado' })
    expect(splitIngredient('2 x 180 g salmon fillet')).toEqual({ quantity: '2 x 180 g', item: 'salmon fillet' })
    expect(splitIngredient('1.5 scoops whey')).toEqual({ quantity: '1.5 scoops', item: 'whey' })
  })

  it('keeps a line with no number as the item, as written', () => {
    expect(splitIngredient('a splash of olive oil')).toEqual({ quantity: '', item: 'a splash of olive oil' })
    expect(splitIngredient('3')).toEqual({ quantity: '', item: '3' })
  })
})

describe('HTML entities in JSON-LD strings', () => {
  it('decodes named and numeric entities before splitting an ingredient', () => {
    const html = page({
      '@type': 'Recipe',
      name: 'Mac &amp; cheese',
      recipeIngredient: ['1 &frac12; cups milk', 'salt &amp; pepper', '&#189; tsp cumin'],
      recipeInstructions: 'Stir&nbsp;well.',
    })
    const recipe = parseRecipe(html)
    expect(recipe.name).toBe('Mac & cheese')
    expect(recipe.ingredients).toEqual([
      { item: 'milk', quantity: '1 ½ cups' },
      { item: 'salt & pepper', quantity: '' },
      { item: 'cumin', quantity: '½ tsp' },
    ])
    expect(recipe.steps).toEqual(['Stir well.'])
  })
})

describe('importFailure', () => {
  it('names a bot wall as blocked, not as a page with no recipe', () => {
    expect(importFailure(new NoRecipe('That page has no schema.org Recipe in it.'), 403).reason).toBe('blocked')
  })

  it('sorts the rest into no JSON-LD, timeout, blocked and parse error', () => {
    const refused = Object.assign(new Error('That address is on a private network, so it will not be fetched.'), { name: 'Refused' })
    expect(importFailure(new NoRecipe('That page has no schema.org Recipe in it.')).reason).toBe('no JSON-LD')
    expect(importFailure(new Error('That page took too long to answer.')).reason).toBe('timeout')
    expect(importFailure(refused)).toEqual({ reason: 'blocked', message: refused.message })
    expect(importFailure(new NoRecipe('That page has a Recipe with no name.')).reason).toBe('parse error')
  })
})
