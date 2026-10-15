import { defineIntegration } from '@/core/integration-contract'
import { notes, repo, VaultError } from './client'

export default defineIntegration({
  id: 'github_vault',
  label: 'Obsidian vault (GitHub)',
  description: 'The private repo holding the Obsidian vault. Second Brain pulls it and proposes commits.',
  docsUrl: 'https://github.com/settings/tokens',

  auth: {
    type: 'token',
    fields: [
      { key: 'repo', label: 'Repository', placeholder: 'nick/obsidian-vault' },
      { key: 'token', label: 'Personal access token', secret: true, placeholder: 'github_pat_...' },
    ],
  },

  // Reads the repo and counts the markdown in it. Two calls rather than one
  // because "the token works" and "this is a vault" are different questions,
  // and a token pointed at the wrong repo answers the first one fine.
  test: async (creds) => {
    try {
      const found = await repo(creds)
      const { notes: md, truncated } = await notes(found.default_branch, creds)
      const warn = truncated ? ' The tree was truncated, so this is a floor, not a count.' : ''
      const visibility = found.private ? 'private' : 'public, which a vault should not be'
      return {
        ok: true,
        detail: `${found.full_name} (${visibility}), ${md.length} markdown files on ${found.default_branch}.${warn}`,
      }
    } catch (error) {
      if (error instanceof VaultError && error.status === 404) {
        return {
          ok: false,
          detail: 'Repository not found, or the token has no access to it. Check the owner/name and that the token grants Contents: Read.',
        }
      }
      if (error instanceof VaultError && error.status === 401) {
        return { ok: false, detail: 'GitHub rejected the token. It may have expired.' }
      }
      return { ok: false, detail: error instanceof Error ? error.message : 'GitHub did not answer.' }
    }
  },
})
