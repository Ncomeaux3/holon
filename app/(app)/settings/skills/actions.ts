'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
import { callTool, ToolInputError } from '@/core/tools'

// Every edit goes through the module's tools rather than straight to SQL, so
// the UI and an MCP client share one implementation and one set of rules.
// Server actions are standalone POST endpoints addressed by id, so the (app)
// layout does not run for them and each of these authenticates on its own.

export type ActionResult = { ok: true } | { ok: false; error: string; fields?: Record<string, string> }

function failed(error: unknown): ActionResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : 'Failed',
    ...(error instanceof ToolInputError && { fields: error.fields }),
  }
}

function done(): ActionResult {
  revalidatePath('/settings/skills')
  revalidatePath('/skills')
  return { ok: true }
}

async function write(input: Record<string, unknown>): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('skills', 'write', input, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

async function restore(input: Record<string, unknown>): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('skills', 'restore', input, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function renameSkill(skillId: string, name: string): Promise<ActionResult> {
  return write({ kind: 'rename', skillId, name })
}

export async function setKeywords(skillId: string, keywords: string[]): Promise<ActionResult> {
  return write({ kind: 'rename', skillId, keywords })
}

export async function deleteSkill(skillId: string): Promise<ActionResult> {
  return write({ kind: 'delete', skillId })
}

export async function addSkill(skillId: string, name: string, parent: string): Promise<ActionResult> {
  return write({ kind: 'custom', skillId, name, parent })
}

export async function restoreSkill(skillId: string): Promise<ActionResult> {
  return restore({ skillId })
}

/** Back to the committed skills.yaml. Every override, gone. */
export async function resetTree(): Promise<ActionResult> {
  return restore({})
}

// The picker on every entity drawer. The whole layout is revalidated because
// the drawer that called this lives on whichever screen the entity is from.
export async function linkSkill(entityRef: string, skillId: string): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('skills', 'link', { entityRef, skillId }, { source: 'ui' })
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (error) {
    return failed(error)
  }
}

export async function unlinkSkill(entityRef: string, skillId: string): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('skills', 'unlink', { entityRef, skillId }, { source: 'ui' })
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (error) {
    return failed(error)
  }
}
