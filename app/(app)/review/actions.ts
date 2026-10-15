'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
import { approve, dismiss, listProposals, reopen } from '@/core/proposals'

// Server actions are standalone POST endpoints addressed by id, so the (app)
// layout does not run for them and each one authenticates independently.

export type ActionResult = { ok: true } | { ok: false; error: string }

function failed(error: unknown): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : 'Failed' }
}

/**
 * `patch` carries the Review panel's inline edit. A diff entry's `field` is the
 * payload key it changes, so editing the after value of one entry is a patch of
 * that key. approve() re-validates through the tool's own schema, so an edit
 * cannot smuggle in a shape the tool would reject.
 */
export async function approveProposal(
  id: string,
  patch?: Record<string, unknown>,
): Promise<ActionResult> {
  await requireOwner()
  try {
    await approve(id, patch)
    revalidatePath('/review')
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (error) {
    // Surfaced rather than thrown: a tool that rejects the write leaves the
    // proposal pending, and the owner needs to see why.
    return failed(error)
  }
}

export async function dismissProposal(id: string): Promise<ActionResult> {
  await requireOwner()
  try {
    await dismiss(id)
    revalidatePath('/review')
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (error) {
    return failed(error)
  }
}

export async function reopenProposal(id: string): Promise<ActionResult> {
  await requireOwner()
  try {
    await reopen(id)
    revalidatePath('/review')
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (error) {
    return failed(error)
  }
}

/**
 * Everything pending that no module marked guarded. Money, policy and goal
 * writes are never in this set, which is the whole point of the button: it
 * clears the noise and leaves the decisions.
 */
export async function approveAllUnguarded(): Promise<ActionResult & { approved?: number }> {
  await requireOwner()

  const pending = (await listProposals('pending')).filter((p) => !p.guarded)
  let approved = 0
  for (const proposal of pending) {
    try {
      await approve(proposal.id)
      approved++
    } catch {
      // One tool refusing does not stop the rest. The failures stay pending and
      // visible in the inbox.
    }
  }

  revalidatePath('/review')
  revalidatePath('/', 'layout')
  return { ok: true, approved }
}
