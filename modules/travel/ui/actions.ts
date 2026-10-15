'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
import { db } from '@/core/db'
import { callTool, ToolInputError } from '@/core/tools'
import { signedUrl, upload } from '@/core/files'
import { KINDS, reservationPath, type Kind } from '../itinerary'

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
  revalidatePath('/travel')
  revalidatePath('/', 'layout')
  return { ok: true }
}

/** Accept a parsed booking into the itinerary, or throw it away. */
export async function decideItem(id: string, accept: boolean): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('travel', 'accept_item', { id, accept }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function setTripStatus(
  id: string,
  status: 'idea' | 'planned' | 'booked' | 'done',
): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('travel', 'write_trip', { id, status }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

/**
 * Tick a packing item.
 *
 * Straight to SQL rather than through a tool: it is a boolean on one row, it
 * is reversible by pressing it again, and giving it a tool would put a
 * checkbox in the MCP surface for no reason.
 */
export async function togglePacked(id: string, packed: boolean): Promise<ActionResult> {
  await requireOwner()
  try {
    await db().query(`update travel.packing_item set packed = $2 where id = $1`, [id, packed])
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function saveLoyalty(
  name: string,
  balance: number,
  kind: 'airline' | 'hotel' | 'card' | 'rail',
): Promise<ActionResult> {
  await requireOwner()

  if (!Number.isFinite(balance) || balance < 0) {
    return { ok: false, error: 'A balance has to be zero or more' }
  }

  try {
    await callTool(
      'travel',
      'set_loyalty',
      { name, balance: Math.round(balance), kind },
      { source: 'ui' },
    )
    return done()
  } catch (error) {
    return failed(error)
  }
}

/** Link a program to the card that earns it, or null to unlink (v1.2 phase 10b). */
export async function linkLoyaltyAccount(id: string, accountRef: string | null): Promise<ActionResult> {
  return through('link_loyalty_account', { id, account_ref: accountRef })
}

/** One call per tool, the same shape for each: authenticate, call, revalidate. */
async function through(tool: string, input: Record<string, unknown>): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('travel', tool, input, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function saveTrip(input: {
  id?: string
  name?: string
  destination?: string
  lat?: number | null
  lon?: number | null
  starts_on?: string | null
  ends_on?: string | null
  budget_cents?: number
  travellers?: number
  status?: 'idea' | 'planned' | 'booked' | 'done'
  notes?: string
  /** The whole set, in order. Left out entirely to leave the destinations alone. */
  destinations?: {
    name: string
    lat?: number | null
    lon?: number | null
    starts_on?: string | null
    ends_on?: string | null
  }[]
}): Promise<ActionResult> {
  return through('write_trip', input)
}

export async function deleteTrip(id: string): Promise<ActionResult> {
  return through('delete_trip', { id })
}

/**
 * Fold one trip into another. Guarded, like every other write to a trip, so it
 * lands in the review inbox when an agent asks for it and goes straight
 * through when the owner presses the button.
 */
export async function mergeTrip(id: string, into: string): Promise<ActionResult> {
  return through('merge_trip', { id, into })
}

export async function saveItem(input: {
  id?: string
  trip_id?: string
  kind?: Kind
  title?: string
  detail?: string
  occurs_on?: string | null
  occurs_at?: string | null
  amount_cents?: number
  confirmation?: string
  place?: string
  status?: 'idea' | 'confirmed'
}): Promise<ActionResult> {
  return through('write_item', input)
}

/**
 * A reservation: a confirmed itinerary item with who it is with, its code and,
 * optionally, the confirmation as a PDF or an image. The file goes to the
 * module's private bucket under the trip's own id, as Insurance keeps a
 * policy's documents under the policy's. reservationPath decides the path.
 */
export async function saveReservation(form: FormData): Promise<ActionResult> {
  await requireOwner()
  try {
    const tripId = String(form.get('trip_id') ?? '')
    const text = (key: string) => String(form.get(key) ?? '').trim()
    const amount = text('amount')
    const dollars = amount === '' ? 0 : Number(amount.replace(/[$,]/g, ''))
    // Checked before the upload, so a refused form leaves no file behind.
    if (!text('title')) throw new Error('Reservation is required')
    if (!Number.isFinite(dollars) || dollars < 0) throw new Error('Amount must be a number')
    const kind = text('kind')
    if (kind && !(KINDS as readonly string[]).includes(kind)) throw new Error('Not a kind of item')

    const file = form.get('file')
    let file_path: string | null = null
    if (file instanceof File && file.size > 0) {
      const path = reservationPath(tripId, file)
      file_path = (await upload('travel', path, Buffer.from(await file.arrayBuffer()), file.type)).path
    }

    await callTool(
      'travel',
      'write_item',
      {
        trip_id: tripId,
        title: text('title'),
        kind: text('kind') || undefined,
        occurs_on: text('occurs_on') || null,
        occurs_at: text('occurs_at') || null,
        provider: text('provider'),
        confirmation: text('confirmation'),
        amount_cents: Math.round(dollars * 100),
        status: 'confirmed',
        file_path,
      },
      { source: 'ui' },
    )
    return done()
  } catch (error) {
    return failed(error)
  }
}

/** A short lived URL for a reservation's file. Nothing in the bucket is public. */
export async function itemFileUrl(id: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  await requireOwner()
  try {
    const { rows } = await db().query<{ file_path: string | null }>(
      `select file_path from travel.itinerary_item where id = $1`,
      [id],
    )
    if (!rows[0]?.file_path) throw new Error('This item has no file')
    return { ok: true, url: await signedUrl({ module: 'travel', path: rows[0].file_path }) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' }
  }
}

export async function deleteItem(id: string): Promise<ActionResult> {
  return through('delete_item', { id })
}

export async function saveBudgetLine(input: {
  trip_id: string
  category: string
  planned_cents?: number
  actual_override_cents?: number | null
}): Promise<ActionResult> {
  return through('write_budget_line', input)
}

export async function deleteBudgetLine(trip_id: string, category: string): Promise<ActionResult> {
  return through('delete_budget_line', { trip_id, category })
}

export async function savePacking(input: {
  trip_id?: string
  id?: string
  label?: string
  packed?: boolean
  remove?: boolean
}): Promise<ActionResult> {
  return through('write_packing', input)
}
