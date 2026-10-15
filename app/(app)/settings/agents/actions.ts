'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
import { setSetting } from '@/core/settings'
import { AUTONOMY_LEVELS, type Autonomy } from '@/core/autonomy'

export type ActionResult = { ok: true } | { ok: false; error: string }

export async function setAutonomy(level: Autonomy): Promise<ActionResult> {
  await requireOwner()
  // Validated rather than trusted: this decides whether an agent may write to
  // the owner's data without asking.
  if (!AUTONOMY_LEVELS.includes(level)) return { ok: false, error: `Not an autonomy level: ${level}` }

  try {
    await setSetting('agent_autonomy', level)
    revalidatePath('/settings/agents')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' }
  }
}

/**
 * The token, only when the owner asks for it. The page renders a mask, so the
 * secret is not sitting in the HTML of a screen left open on a second monitor.
 */
export async function revealMcpToken(): Promise<string> {
  await requireOwner()
  return process.env.MCP_TOKEN ?? ''
}
