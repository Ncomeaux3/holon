import { defineIntegration } from '@/core/integration-contract'

export default defineIntegration({
  id: 'resend',
  label: 'Resend',
  description: 'Sends the one daily digest email. No domain needed to reach your own inbox.',
  docsUrl: 'https://resend.com/api-keys',

  auth: {
    type: 'token',
    fields: [{ key: 'api_key', label: 'API key', secret: true, placeholder: 're_...' }],
  },

  // Listing keys authenticates without sending anything.
  test: async ({ api_key }) => {
    try {
      const res = await fetch('https://api.resend.com/api-keys', {
        headers: { Authorization: `Bearer ${api_key}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        return { ok: false, detail: `${res.status} ${res.statusText}` }
      }
      const body = (await res.json()) as { data?: unknown[] }
      return {
        ok: true,
        detail: `Authenticated, ${body.data?.length ?? 0} key(s) on the account`,
      }
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'Request failed' }
    }
  },
})
