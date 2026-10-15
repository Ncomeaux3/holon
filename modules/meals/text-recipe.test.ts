import { describe, expect, it } from 'vitest'
import { fromModel, readRecipeText } from './text-recipe'

describe('readRecipeText', () => {
  it('reads the name, unit lines as ingredients and numbered lines as steps', () => {
    const read = readRecipeText(
      ['Turkey chili', 'Serves 6', '900 g ground turkey', '2 cans kidney beans', '1. Brown the turkey.', '2) Simmer 30 min.'].join('\n'),
    )
    expect(read.recipe).toMatchObject({
      name: 'Turkey chili',
      servings: 6,
      ingredients: [
        { item: 'ground turkey', quantity: '900 g' },
        { item: 'kidney beans', quantity: '2 cans' },
      ],
      steps: ['Brown the turkey.', 'Simmer 30 min.'],
    })
    expect(read.complete).toBe(true)
    expect(read.rest).toEqual([])
  })

  it('takes every line under an Ingredients or Method heading, bullets stripped', () => {
    const read = readRecipeText(
      ['Oats', '', 'Ingredients:', '- Rolled oats', '• 1 banana', 'Method', 'Soak overnight.', 'Eat cold.'].join('\n'),
    )
    expect(read.recipe.ingredients).toEqual([
      { item: 'Rolled oats', quantity: '' },
      { item: 'banana', quantity: '1' },
    ])
    expect(read.recipe.steps).toEqual(['Soak overnight.', 'Eat cold.'])
    expect(read.complete).toBe(true)
  })

  it('leaves what it cannot place in rest, and is not complete without both parts', () => {
    // An Instagram caption: prose, hashtags, no headings.
    const read = readRecipeText('Best pasta ever 🍝\nToss it all together and enjoy\n#pasta #dinner\n200 g spaghetti')
    expect(read.recipe.name).toBe('Best pasta ever 🍝')
    expect(read.recipe.ingredients).toEqual([{ item: 'spaghetti', quantity: '200 g' }])
    expect(read.recipe.steps).toEqual([])
    expect(read.rest).toEqual(['Toss it all together and enjoy', '#pasta #dinner'])
    expect(read.complete).toBe(false)
  })

  it('does not read a numbered step that starts with a quantity as an ingredient', () => {
    const read = readRecipeText('Toast\n2 slices bread\n1. 2 minutes under the grill.')
    expect(read.recipe.ingredients).toEqual([{ item: 'bread', quantity: '2 slices' }])
    expect(read.recipe.steps).toEqual(['2 minutes under the grill.'])
  })

  it('does not read a decimal quantity as a numbered step', () => {
    const read = readRecipeText('Bread\nIngredients\n1.5 cups flour\n0.5 tsp salt\nMethod\nMix.')
    expect(read.recipe.ingredients).toEqual([
      { item: 'flour', quantity: '1.5 cups' },
      { item: 'salt', quantity: '0.5 tsp' },
    ])
    expect(read.recipe.steps).toEqual(['Mix.'])
  })

  it('keeps a step that mentions a time or a yield as a step', () => {
    const read = readRecipeText('Cookies\n200 g flour\nMethod\n3. Rest 10 min, then it is time to bake\nMakes 12 cookies')
    expect(read.recipe.steps).toEqual(['Rest 10 min, then it is time to bake', 'Makes 12 cookies'])
    expect(read.recipe.time_minutes).toBe(0)
    expect(read.recipe.servings).toBe(1)
  })

  it('names a recipe that opens with a heading Pasted recipe rather than after an ingredient', () => {
    expect(readRecipeText('Ingredients:\n200 g rice\nMethod\nBoil.').recipe.name).toBe('Pasted recipe')
  })

  it('reads a time line in hours and minutes', () => {
    expect(readRecipeText('Stew\nTotal time: 1 hr 30 min').recipe.time_minutes).toBe(90)
    expect(readRecipeText('Stew\nReady in 45 minutes').recipe.time_minutes).toBe(45)
  })
})

describe('fromModel', () => {
  it('reads the JSON reply, splitting ingredient lines', () => {
    const reply = 'Here it is:\n{"name":"Pasta","servings":2,"time_minutes":20,"ingredients":["200 g spaghetti","Salt"],"steps":["Boil.","Toss."],"confidence":0.8}'
    expect(fromModel(reply)).toEqual({
      recipe: {
        name: 'Pasta',
        servings: 2,
        time_minutes: 20,
        kcal: 0,
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
        ingredients: [
          { item: 'spaghetti', quantity: '200 g' },
          { item: 'Salt', quantity: '' },
        ],
        steps: ['Boil.', 'Toss.'],
      },
      confidence: 0.8,
    })
  })

  it('returns null for a reply with no usable recipe', () => {
    expect(fromModel('Sorry, no recipe here.')).toBeNull()
    expect(fromModel('{"name":"","ingredients":[],"steps":[]}')).toBeNull()
  })
})
