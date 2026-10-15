'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
import { db } from '@/core/db'
import { signedUrl, upload } from '@/core/files'
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
  revalidatePath('/health')
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function markMedication(id: string, taken: boolean): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('health', 'mark_medication', { id, taken }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function completeScreening(id: string): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('health', 'complete_screening', { id }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

/**
 * Push a screening out.
 *
 * Straight to SQL: it is one date on one row, reversible by completing or
 * snoozing again, and a tool for it would put a snooze button in the MCP
 * surface for no reason. Snoozing is not dismissing, so there is no way here to
 * make a screening go away permanently.
 */
export async function snoozeScreening(id: string, months: number): Promise<ActionResult> {
  await requireOwner()

  if (!Number.isInteger(months) || months < 1 || months > 24) {
    return { ok: false, error: 'A snooze is between one and twenty four months' }
  }

  try {
    await db().query(
      `update health.screening
          set snooze_until = core.today() + make_interval(months => $2)
        where id = $1`,
      [id, months],
    )
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function setAppointmentStatus(
  id: string,
  status: 'confirmed' | 'held' | 'done' | 'cancelled',
): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('health', 'write_appointment', { id, status }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

/** "$40 copay" to 4000; null when there is no number in it. */
function centsIn(text: string): number | null {
  const m = text.replace(/,/g, '').match(/\d+(?:\.\d{1,2})?/)
  return m ? Math.round(Number(m[0]) * 100) : null
}

/**
 * The Log a visit form. A future date is an appointment; a past one is a
 * record, with the attachment in the module's private bucket and the cost
 * kept as one of the record's fields, because nothing posts it anywhere.
 */
export async function logVisit(form: FormData): Promise<ActionResult> {
  await requireOwner()
  try {
    const title = String(form.get('title') ?? '').trim()
    const date = String(form.get('date') ?? '')
    const kind = String(form.get('kind') ?? 'visit')
    const providerId = String(form.get('provider') ?? '')
    const cost = String(form.get('cost') ?? '').trim()
    const notes = String(form.get('notes') ?? '').trim()
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('A title and a date are required.')

    const { rows } = await db().query<{ today: string }>(`select core.today()::text as today`)
    const future = date > rows[0].today

    if (future) {
      await callTool(
        'health',
        'write_appointment',
        {
          what: title,
          starts_at: `${date}T12:00:00`,
          notes,
          cost_estimate_cents: centsIn(cost),
          provider_id: providerId || null,
        },
        { source: 'ui' },
      )
      return done()
    }

    const file = form.get('file')
    let filePath: string | null = null
    if (file instanceof File && file.size > 0) {
      const ok = file.type === 'application/pdf' || file.type.startsWith('image/')
      if (!ok) throw new Error('A PDF or an image, please')
      const stored = await upload(
        'health',
        `records/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, '_')}`,
        Buffer.from(await file.arrayBuffer()),
        file.type,
      )
      filePath = stored.path
    }

    const { rows: provider } = providerId
      ? await db().query<{ name: string }>(`select name from health.provider where id = $1`, [providerId])
      : { rows: [] as { name: string }[] }

    await callTool(
      'health',
      'write_record',
      {
        title,
        kind,
        taken_on: date,
        summary: notes,
        fields: {
          ...(provider[0] && { Provider: provider[0].name }),
          ...(cost && { Cost: cost }),
        },
        file_path: filePath,
      },
      { source: 'ui' },
    )
    return done()
  } catch (error) {
    return failed(error)
  }
}

/** A short lived URL for a record's file. Nothing in the bucket is public. */
export async function recordUrl(id: string): Promise<{ ok: true; url: string } | { ok: false; error: string; fields?: Record<string, string> }> {
  await requireOwner()
  try {
    const { rows } = await db().query<{ file_path: string | null }>(
      `select file_path from health.record where id = $1`,
      [id],
    )
    if (!rows[0]?.file_path) throw new Error('This record has no file behind it')
    return { ok: true, url: await signedUrl({ module: 'health', path: rows[0].file_path }) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' }
  }
}
