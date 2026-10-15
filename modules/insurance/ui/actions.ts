'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
import { db } from '@/core/db'
import { remove, signedUrl, upload } from '@/core/files'
import { callTool, ToolInputError } from '@/core/tools'
import { revealNumber } from '../data'
import { draftFromPdf } from '../extract'
import type { DraftField } from '../draft'

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
  revalidatePath('/insurance')
  revalidatePath('/', 'layout')
  return { ok: true }
}

/**
 * The plaintext policy number, on request.
 *
 * Its own action rather than a field on the list, so a policy number is only
 * ever in a response the owner asked for. Nothing caches it.
 */
export async function reveal(id: string): Promise<{ ok: true; number: string } | { ok: false; error: string; fields?: Record<string, string> }> {
  await requireOwner()
  try {
    return { ok: true, number: await revealNumber(id) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' }
  }
}

export async function savePolicy(input: {
  id?: string
  kind?: string
  name?: string
  carrier?: string
  policyNumber?: string
  expiresOn?: string | null
  premiumCents?: number
  cadence?: string
  deductibleCents?: number | null
  limits?: string
  agentName?: string
  agentContact?: string
  reminderLeads?: number[]
  postToFinance?: boolean
  status?: string
  notes?: string
}): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool(
      'insurance',
      'write_policy',
      {
        id: input.id,
        kind: input.kind,
        name: input.name,
        carrier: input.carrier,
        policy_number: input.policyNumber,
        expires_on: input.expiresOn,
        premium_cents: input.premiumCents,
        cadence: input.cadence,
        deductible_cents: input.deductibleCents,
        limits: input.limits,
        agent_name: input.agentName,
        agent_contact: input.agentContact,
        reminder_leads: input.reminderLeads,
        post_to_finance: input.postToFinance,
        status: input.status,
        notes: input.notes,
      },
      { source: 'ui' },
    )
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function renewPolicy(id: string, expiresOn: string): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('insurance', 'renew_policy', { id, expires_on: expiresOn }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

export type DraftResult =
  | { ok: true; fields: DraftField[]; filePath: string; fileName: string }
  | { ok: false; error: string; fields?: Record<string, string> }

/**
 * Read a declarations page and draft the fields.
 *
 * Nothing is written to insurance.policy here. The PDF is stored in the
 * module's private bucket, because that is where it lives if the draft is
 * accepted, and discardDraft removes it if it is not.
 */
export async function draftPolicy(form: FormData): Promise<DraftResult> {
  await requireOwner()
  try {
    const file = form.get('file')
    if (!(file instanceof File)) throw new Error('No file was sent')
    if (file.type !== 'application/pdf') throw new Error('That is not a PDF')

    const draft = await draftFromPdf(file.name, Buffer.from(await file.arrayBuffer()))
    return { ok: true, fields: draft.fields, filePath: draft.file.path, fileName: draft.fileName }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' }
  }
}

export async function discardDraft(filePath: string): Promise<ActionResult> {
  await requireOwner()
  try {
    await remove({ module: 'insurance', path: filePath })
    return done()
  } catch (error) {
    return failed(error)
  }
}

/**
 * Create the policy the owner confirmed, and attach the PDF it came from.
 *
 * The fields are whatever is in the form after editing, so a value the model
 * got wrong is never what gets stored: the owner's version is.
 */
export async function createFromDraft(input: {
  fields: Record<string, string>
  filePath: string
  fileName: string
  pages: number
}): Promise<ActionResult> {
  await requireOwner()
  try {
    const f = input.fields
    const dollars = (value: string) => {
      const n = Number(value.replace(/[^0-9.]/g, ''))
      return Number.isFinite(n) && value.trim() !== '' ? Math.round(n * 100) : null
    }

    const KINDS = ['auto', 'renters', 'homeowners', 'health', 'dental', 'vision', 'life', 'pet', 'device', 'umbrella', 'other']
    const CADENCES = ['monthly', 'quarterly', 'semiannual', 'annual']

    const result = await callTool(
      'insurance',
      'write_policy',
      {
        // A kind the model invented becomes 'other' rather than failing the
        // save and losing eleven fields of typing.
        kind: KINDS.includes(f.kind) ? f.kind : 'other',
        name: f.name?.trim() || input.fileName.replace(/\.pdf$/i, ''),
        carrier: f.carrier ?? '',
        policy_number: f.policy_number || undefined,
        expires_on: /^\d{4}-\d{2}-\d{2}$/.test(f.expires_on ?? '') ? f.expires_on : null,
        premium_cents: dollars(f.premium ?? '') ?? 0,
        cadence: CADENCES.includes(f.cadence) ? f.cadence : 'monthly',
        deductible_cents: dollars(f.deductible ?? ''),
        limits: f.limits ?? '',
        agent_name: f.agent_name ?? '',
        agent_contact: f.agent_contact ?? '',
      },
      { source: 'ui' },
    )
    const id = (result.status === 'done' ? (result.result as { id?: string }) : null)?.id
    if (!id) throw new Error('The policy was not created')

    await db().query(
      `insert into insurance.document (policy_id, name, meta, file_path)
       values ($1, $2, $3, $4)`,
      [id, input.fileName, 'drafted from this file', input.filePath],
    )

    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function deletePolicy(id: string): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('insurance', 'delete_policy', { id }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

/**
 * Attach a PDF to a policy that already exists. The file goes to the module's
 * private bucket and a document row points at it; nothing is read out of it.
 */
export async function attachDocument(form: FormData): Promise<ActionResult> {
  await requireOwner()
  try {
    const policyId = String(form.get('policyId') ?? '')
    const file = form.get('file')
    if (!(file instanceof File)) throw new Error('No file was sent')
    if (file.type !== 'application/pdf') throw new Error('That is not a PDF')

    const stored = await upload(
      'insurance',
      `${policyId}/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, '_')}`,
      Buffer.from(await file.arrayBuffer()),
      'application/pdf',
    )
    const now = new Date()
    const meta = `${Math.max(1, Math.round(file.size / 1024))} KB · ${now.toLocaleString('en-US', { month: 'short' })} ${now.getFullYear()}`
    await callTool(
      'insurance',
      'attach_document',
      { policy_id: policyId, name: file.name, meta, file_path: stored.path },
      { source: 'ui' },
    )
    return done()
  } catch (error) {
    return failed(error)
  }
}

/** A short lived URL for one document's file. Nothing in the bucket is public. */
export async function documentUrl(id: string): Promise<{ ok: true; url: string } | { ok: false; error: string; fields?: Record<string, string> }> {
  await requireOwner()
  try {
    const { rows } = await db().query<{ file_path: string | null }>(
      `select file_path from insurance.document where id = $1`,
      [id],
    )
    if (!rows[0]?.file_path) throw new Error('This document has no file behind it')
    return { ok: true, url: await signedUrl({ module: 'insurance', path: rows[0].file_path }) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' }
  }
}
