'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
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

function done(): ActionResult {
  revalidatePath('/ideas')
  revalidatePath('/', 'layout')
  return { ok: true }
}

export type IdeaInput = {
  id?: string
  title?: string
  pitch?: string
  notes?: string
  stage?: 'exploring' | 'validated' | 'building' | 'killed'
  effort?: number
  impact?: number
  killed_reason?: string
  goal_ref?: string | null
  tags?: string[]
}

/** Create or update an idea in one write. The capture line and the form both land here. */
export async function saveIdea(input: IdeaInput): Promise<ActionResult> {
  await requireOwner()
  if (!input.id && !input.title?.trim()) return { ok: false, error: 'An idea needs a title' }
  try {
    await callTool('ideas', 'write', input, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function deleteIdea(id: string): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('ideas', 'delete', { id }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function mergeIdeas(keep: string, drop: string): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('ideas', 'merge', { keep, drop }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

/** Draft the validation task. The tool writes it as an agent, so it lands in review. */
export async function draftTask(id: string): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('ideas', 'draft_task', { id }, { source: 'ui' })
    revalidatePath('/tasks')
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function moveIdea(
  id: string,
  stage: 'exploring' | 'validated' | 'building' | 'killed',
  killedReason?: string,
): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool(
      'ideas',
      'write',
      { id, stage, ...(killedReason !== undefined && { killed_reason: killedReason }) },
      { source: 'ui' },
    )
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function scoreIdea(
  id: string,
  effort: number,
  impact: number,
): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('ideas', 'write', { id, effort, impact }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

/**
 * Run the rubric. This spends money, so it is one deliberate press.
 *
 * The tool is guarded, which means an agent asking lands in the Review inbox.
 * The owner pressing the button is the approval, which is what source: 'ui'
 * says.
 */
export async function researchIdea(
  id: string,
  depth: 'quick' | 'deep',
): Promise<ActionResult> {
  await requireOwner()
  try {
    const result = await callTool('ideas', 'research', { id, depth }, { source: 'ui' })
    const run =
      result.status === 'done'
        ? (result.result as { status: string; detail: string; costCents: number })
        : null
    if (run?.status === 'failed') return { ok: false, error: run.detail }
    return done()
  } catch (error) {
    return failed(error)
  }
}
