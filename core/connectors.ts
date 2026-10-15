import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { getIntegrations } from './integrations'

// The catalogue Onboarding offers, from config/connectors.yaml.
//
// Committed config rather than a table: a fork edits the file, and it is the
// one place that knows what a person might plausibly want to connect. Nothing
// in it claims to work; whether a provider actually syncs is decided here, by
// asking the integration registry.

export type Category = {
  id: string
  name: string
  module: string
  data: string
  providers: string[]
}

export type Provider = {
  name: string
  categoryId: string
  /**
   * True when an integration manifest can actually sync it. False means the
   * choice is still recorded, as core.connections.status = 'requested', which
   * is honest: the wish is saved, it shows in Settings, and nothing pretends.
   */
  supported: boolean
}

let cached: Category[] | undefined

export function loadCategories(): Category[] {
  if (cached) return cached

  const file = join(process.cwd(), 'config', 'connectors.yaml')
  const parsed = parse(readFileSync(file, 'utf8')) as { categories?: Category[] }
  cached = parsed.categories ?? []
  return cached
}

/**
 * Which catalogue entries a real integration backs.
 *
 * Matched on the manifest id appearing in the provider name, lowercased: the
 * catalogue is written for a person to read and the registry is written for a
 * machine, so the join is deliberately loose. A miss costs nothing, because the
 * unsupported path still records the intent.
 */
export function supportedProviders(): Set<string> {
  const ids = getIntegrations().map((i) => i.id.toLowerCase())
  const supported = new Set<string>()

  for (const category of loadCategories()) {
    for (const provider of category.providers) {
      const key = provider.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (ids.some((id) => key.includes(id.replace(/[^a-z0-9]/g, '')))) {
        supported.add(provider)
      }
    }
  }

  return supported
}

/** The catalogue, narrowed to the modules a fork actually installed. */
export function categoriesForModules(moduleIds: string[]): Category[] {
  return loadCategories().filter((c) => moduleIds.includes(c.module))
}
