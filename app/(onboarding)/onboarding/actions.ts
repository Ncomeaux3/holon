'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
import { db } from '@/core/db'
import { setSetting, type Settings } from '@/core/settings'
import { callTool, ToolInputError } from '@/core/tools'

// Server actions are standalone POST endpoints addressed by id, so the (app)
// layout does not run for them and each one authenticates independently.

export type ActionResult = { ok: true } | { ok: false; error: string; fields?: Record<string, string> }

function failed(error: unknown): ActionResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : 'Failed',
    ...(error instanceof ToolInputError && { fields: error.fields }),
  }
}

/**
 * The keys first run is allowed to write.
 *
 * A server action accepts whatever it is sent and the type parameter is erased
 * at runtime, so without this the wizard would be a general purpose write to
 * any setting, including the model spend cap and the agent autonomy level.
 */
const SETUP_KEYS = [
  'owner_name',
  'timezone',
  'modules_enabled',
  'digest_morning_enabled',
  'digest_evening_at',
  'digest_evening_enabled',
  'quiet_from',
  'quiet_to',
  'quiet_urgent_override',
  'onboarding_completed_at',
] as const

type SetupKey = (typeof SETUP_KEYS)[number]

export async function saveSetting<K extends SetupKey>(
  key: K,
  value: Settings[K],
): Promise<ActionResult> {
  await requireOwner()
  if (!(SETUP_KEYS as readonly string[]).includes(key)) {
    return { ok: false, error: `${key} is not a first run setting` }
  }
  try {
    await setSetting(key, value)
    revalidatePath('/onboarding')
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (error) {
    return failed(error)
  }
}

/**
 * Record that the owner wants a provider connected.
 *
 * A provider with no integration manifest saves as `requested`. That is the
 * honest state: the intent is recorded, it shows in Settings, and nothing
 * pretends to sync. A provider that does have one still has to be authorised
 * properly at Settings, Connections, because a wizard is not the place to
 * handle a secret.
 */
export async function requestProvider(
  provider: string,
  categoryId: string,
): Promise<ActionResult> {
  await requireOwner()

  if (!provider.trim()) return { ok: false, error: 'Pick a provider first' }

  try {
    // integration_id holds the provider name for a request. It is not a
    // manifest id and never resolves to one, which is the point: status
    // 'requested' is what every reader gates on, and core/modules.ts asks for
    // 'connected' explicitly, so a wish can never be mistaken for a live sync.
    //
    // credentials_encrypted is empty because there are none. A request is an
    // intention, and giving it a fake secret to satisfy a NOT NULL would be
    // the kind of quiet lie this codebase spends comments avoiding.
    await db().query(
      `insert into core.connections (integration_id, credentials_encrypted, status, last_test_detail)
       values ($1, '', 'requested', $2)
       on conflict (integration_id) do update
         set last_test_detail = excluded.last_test_detail
       where core.connections.status = 'requested'`,
      [provider, `Requested during first run, ${categoryId}`],
    )
    revalidatePath('/onboarding')
    return { ok: true }
  } catch (error) {
    return failed(error)
  }
}

export async function removeProvider(provider: string): Promise<ActionResult> {
  await requireOwner()
  try {
    // Only a requested one. A connection holding real credentials is removed at
    // Settings, deliberately, and never by a wizard the owner is skimming.
    await db().query(
      `delete from core.connections where integration_id = $1 and status = 'requested'`,
      [provider],
    )
    revalidatePath('/onboarding')
    return { ok: true }
  } catch (error) {
    return failed(error)
  }
}

export type GoalSeed = {
  title: string
  area: string
  kind: 'number' | 'count' | 'streak' | 'milestone'
  unit: string
  target_value: number
  deadline: string
  metric_source: string | null
}

/**
 * Seed the goals the owner picked, through the goals module's own tool.
 *
 * Through callTool rather than SQL so the module's validation runs and the
 * entity is registered, and skipped entirely when Goals is not installed: a
 * fork without it gets a wizard with one step fewer, not an error.
 */
export async function seedGoals(goals: GoalSeed[]): Promise<ActionResult & { created?: number }> {
  await requireOwner()

  let created = 0
  const refused: string[] = []

  for (const goal of goals) {
    try {
      await callTool('goals', 'write', goal, { source: 'ui' })
      created++
    } catch (error) {
      refused.push(error instanceof Error ? error.message : 'refused')
    }
  }

  revalidatePath('/goals')
  revalidatePath('/onboarding')

  if (created === 0 && refused.length > 0) return { ok: false, error: refused[0] }
  return { ok: true, created }
}

/** Finish, and stop the wizard offering itself. */
export async function finish(): Promise<ActionResult> {
  await requireOwner()
  try {
    await setSetting('onboarding_completed_at', new Date().toISOString())
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (error) {
    return failed(error)
  }
}
