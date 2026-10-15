import { cache } from 'react'
import { modules } from '../modules/_index'
import { db } from './db'
import type { LinkedItem, ModuleManifest } from './module-contract'

// The registry. The contract it implements lives in core/module-contract.ts,
// which imports nothing, so a manifest can import defineModule without this
// file and its module graph coming with it.

export {
  defineModule,
  defineTool,
  type ModuleJob,
  type ModuleManifest,
  type ModuleTool,
  type ToolContext,
} from './module-contract'

/** Every module, nav order first so callers do not each re-sort. */
export function getModules(): ModuleManifest[] {
  return [...modules].sort((a, b) => a.nav.order - b.nav.order)
}

export function getModule(id: string): ModuleManifest | undefined {
  return modules.find((m) => m.id === id)
}

/**
 * The one module that classifies entities to skills, if it is installed.
 *
 * Two would each write core.skill_links for the same entity and the result
 * would depend on array order, so this throws rather than picking one. A
 * template that ships without modules/skills gets undefined, and register()
 * simply does not classify.
 */
export function getClassifier(): ModuleManifest['classifier'] {
  const found = modules.filter((m) => m.classifier)
  if (found.length > 1) {
    throw new Error(
      `Two modules declare a classifier (${found.map((m) => m.id).join(', ')}). Only one may.`,
    )
  }
  return found[0]?.classifier
}

/** Everything any module keeps about an entity, in module order. */
export async function getLinked(entityRef: string): Promise<LinkedItem[]> {
  const lists = await Promise.all(modules.filter((m) => m.linked).map((m) => m.linked!(entityRef)))
  return lists.flat()
}

/** Spend against each entity, summed over every module that keeps some. */
export async function getSpend(
  entityRefs: string[],
  range?: { from: string; to: string },
): Promise<Record<string, { cents: number; count: number }>> {
  const out: Record<string, { cents: number; count: number }> = {}
  if (entityRefs.length === 0) return out
  const parts = await Promise.all(modules.filter((m) => m.spend).map((m) => m.spend!(entityRefs, range)))
  for (const part of parts) {
    for (const [ref, v] of Object.entries(part)) {
      const was = out[ref] ?? { cents: 0, count: 0 }
      out[ref] = { cents: was.cents + v.cents, count: was.count + v.count }
    }
  }
  return out
}

/** Where to open a registry entity: its module's drawer, else the module's page. Null for an unknown module. */
export function entityHref(module: string, entityType: string, entityId: string): string | null {
  const m = getModule(module)
  return m ? (m.entityHref?.(entityType, entityId) ?? `/${module}`) : null
}

/** The skill names the tree module provides, or nothing when there is no tree. Once per request. */
export const getSkillNames = cache(async (): Promise<Record<string, string>> => {
  const found = modules.find((m) => m.skillNames)
  return found?.skillNames ? found.skillNames() : {}
})

/**
 * Which of these integrations have no connected row yet. Drives the
 * "Connect <provider>" card that stands in for a module's pages.
 */
export async function missingConnections(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const { rows } = await db().query<{ integration_id: string }>(
    `select integration_id from core.connections
     where integration_id = any($1) and status = 'connected'`,
    [ids],
  )
  const connected = new Set(rows.map((r) => r.integration_id))
  return ids.filter((id) => !connected.has(id))
}
