import { defineIntegration } from '@/core/integration-contract'
import { VOYAGE_DIMENSIONS, VOYAGE_MODEL, embed } from './client'

export default defineIntegration({
  id: 'voyage',
  label: 'Voyage AI',
  description: `Embeds every entity for semantic search, ${VOYAGE_MODEL} at ${VOYAGE_DIMENSIONS} dimensions.`,
  docsUrl: 'https://dash.voyageai.com/api-keys',

  auth: {
    type: 'token',
    fields: [{ key: 'api_key', label: 'API key', secret: true, placeholder: 'pa-...' }],
  },

  // Voyage has no free metadata endpoint, so the cheapest honest check is one
  // embedding of one short word. A handful of tokens against a 200M allowance.
  test: async ({ api_key }) => {
    try {
      const [vector] = await embed(['ping'], 'document', api_key)
      if (vector?.length !== VOYAGE_DIMENSIONS) {
        return {
          ok: false,
          detail: `Expected ${VOYAGE_DIMENSIONS} dimensions, got ${vector?.length ?? 0}. core.embeddings would reject these.`,
        }
      }
      return { ok: true, detail: `${VOYAGE_MODEL}, ${vector.length} dimensions` }
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'Request failed' }
    }
  },
})
