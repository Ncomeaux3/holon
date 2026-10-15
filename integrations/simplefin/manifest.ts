import { defineIntegration } from '@/core/integration-contract'
import { accounts, claim, SimpleFinError } from './client'

export default defineIntegration({
  id: 'simplefin',
  label: 'SimpleFIN Bridge',
  description: 'Bank balances and transactions for the Finance module. $1.50/mo or $15/yr.',
  docsUrl: 'https://beta-bridge.simplefin.org/',

  auth: {
    type: 'token',
    fields: [
      {
        key: 'access_url',
        label: 'Access URL',
        secret: true,
        // Paste either. A base64 setup token is claimed on save and the
        // resulting access URL is what gets stored; an access URL is kept as
        // is. A token can only be claimed once, which is why the exchange
        // happens here rather than on every sync.
        placeholder: 'Setup token, or https://user:pass@bridge.simplefin.org/simplefin',
      },
    ],
  },

  // A setup token is claimed here, on save, and the access URL is what gets
  // stored. It cannot go in test(): a token can only be claimed once, so a
  // test() that claimed would store the spent token and the next Test press
  // would 403 with the working URL already gone.
  prepare: async (creds) => {
    const value = (creds.access_url ?? '').trim()
    if (value === '' || value.startsWith('http')) return creds
    return { ...creds, access_url: await claim(value) }
  },

  // A one day window, so the check is cheap and still proves the credential
  // reaches real institutions rather than merely parsing.
  test: async (creds) => {
    try {
      const url = (creds.access_url ?? '').trim()
      if (!url.startsWith('http')) {
        return { ok: false, detail: 'No access URL stored. Paste a setup token to claim one.' }
      }
      const yesterday = new Date(Date.now() - 86_400_000)
      const { accounts: found, warnings } = await accounts(yesterday, url)

      if (found.length === 0) {
        return {
          ok: false,
          detail: warnings.length > 0
            ? `The bridge answered but returned no accounts: ${warnings.join('; ')}`
            : 'The bridge answered but has no accounts connected. Add one on the bridge first.',
        }
      }

      const names = found.map((a) => a.name).join(', ')
      const warn = warnings.length > 0 ? ` Warnings: ${warnings.join('; ')}` : ''
      return { ok: true, detail: `${found.length} accounts: ${names}.${warn}` }
    } catch (error) {
      if (error instanceof SimpleFinError && error.status === 402) {
        return { ok: false, detail: 'The bridge says payment is required. The subscription has lapsed.' }
      }
      return { ok: false, detail: error instanceof Error ? error.message : 'The bridge did not answer.' }
    }
  },
})
