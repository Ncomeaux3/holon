import { defineIntegration } from '@/core/integration-contract'
import { searchFoods } from './client'

export default defineIntegration({
  id: 'usda',
  label: 'USDA FoodData Central',
  description: 'Macros per 100 g for a recipe ingredient, picked by name in the recipe form. A free key from api.data.gov.',
  docsUrl: 'https://fdc.nal.usda.gov/api-key-signup',

  auth: {
    type: 'token',
    fields: [{ key: 'api_key', label: 'API key', secret: true, placeholder: 'from api.data.gov' }],
  },

  // One search is the cheapest call there is: free, one of the hour's 1,000.
  test: async ({ api_key }) => {
    try {
      const foods = await searchFoods('egg', api_key)
      return { ok: true, detail: foods[0] ? `Reachable, ${foods[0].description}` : 'Reachable, no foods returned' }
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'Request failed' }
    }
  },
})
