import { integrations } from '../integrations/_index'
import type { IntegrationManifest } from './integration-contract'

// Re-exported because this is where callers look. The definitions live in
// core/integration-contract.ts so a manifest can import defineIntegration
// without the registry and its module graph coming with it.
export * from './integration-contract'
// Re-exported because callers look for them here; they live in
// core/credentials.ts so a client can import them without the registry.
export * from './credentials'

export function getIntegrations(): IntegrationManifest[] {
  return [...integrations].sort((a, b) => a.label.localeCompare(b.label))
}

export function getIntegration(id: string): IntegrationManifest | undefined {
  return integrations.find((i) => i.id === id)
}
