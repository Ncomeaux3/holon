'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
import { callTool, ToolInputError } from '@/core/tools'

export type ActionResult = { ok: true } | { ok: false; error: string; fields?: Record<string, string> }

/**
 * Dropping an event onto a different skill. Server actions are standalone POST
 * endpoints addressed by id, so the (app) layout does not run for them and this
 * authenticates on its own.
 */
export async function reassignEvent(
  entityRef: string,
  fromSkillId: string,
  toSkillId: string,
): Promise<ActionResult> {
  await requireOwner()

  try {
    // Through the tool rather than straight to SQL, so the one write that sets
    // is_manual has one implementation and the MCP client gets the same one.
    await callTool('skills', 'reassign', { entityRef, fromSkillId, toSkillId }, { source: 'ui' })
    revalidatePath('/skills')
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed',
      ...(error instanceof ToolInputError && { fields: error.fields }),
    }
  }
}
