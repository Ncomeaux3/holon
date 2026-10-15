import { defineIntegration } from '@/core/integration-contract'

export default defineIntegration({
  id: 'anthropic',
  label: 'Anthropic',
  description: 'Classifies entities to skills and writes the daily headline.',
  docsUrl: 'https://console.anthropic.com/settings/keys',

  auth: {
    type: 'token',
    fields: [{ key: 'api_key', label: 'API key', secret: true, placeholder: 'sk-ant-...' }],
  },

  // Listing models costs nothing and no tokens, so Test is free to press.
  test: async ({ api_key }) => {
    try {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
        headers: { 'x-api-key': api_key, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        return { ok: false, detail: `${res.status} ${res.statusText}` }
      }
      const body = (await res.json()) as { data?: { id: string }[] }
      return { ok: true, detail: `Reachable, ${body.data?.[0]?.id ?? 'models listed'}` }
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'Request failed' }
    }
  },
})
