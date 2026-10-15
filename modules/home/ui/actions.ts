'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
import { db } from '@/core/db'
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
  revalidatePath('/home')
  revalidatePath('/', 'layout')
  return { ok: true }
}

/**
 * Mark a scheduled job done today.
 *
 * Goes through log_service rather than writing `last_done_on` directly, so a
 * job ticked off the calendar leaves the same history row as one entered by
 * hand. A schedule that moved with no record behind it would be the calendar
 * quietly disagreeing with the log.
 */
export async function markDone(
  serviceId: string,
  assetId: string,
  what: string,
): Promise<ActionResult> {
  await requireOwner()
  try {
    const { rows } = await db().query<{ today: string; cost: number; vendor_id: string | null }>(
      `select core.today()::text as today, s.cost_estimate_cents as cost, s.vendor_id
         from home.service s where s.id = $1`,
      [serviceId],
    )
    if (rows.length === 0) throw new Error('No such service')

    await callTool(
      'home',
      'log_service',
      {
        asset_id: assetId,
        service_id: serviceId,
        vendor_id: rows[0].vendor_id ?? undefined,
        what,
        done_on: rows[0].today,
        // The estimate is not a receipt. Marking done from the calendar records
        // that it happened, not what it cost.
        cost_cents: null,
      },
      { source: 'ui' },
    )
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function logService(input: {
  assetId: string
  /** The scheduled job this entry completes, when it was opened from one. */
  serviceId?: string
  what: string
  doneOn: string
  costCents: number | null
  vendorId: string | null
  intervalMonths: number
  notes: string
}): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool(
      'home',
      'log_service',
      {
        asset_id: input.assetId,
        service_id: input.serviceId,
        vendor_id: input.vendorId ?? undefined,
        what: input.what,
        done_on: input.doneOn,
        cost_cents: input.costCents,
        notes: input.notes,
      },
      { source: 'ui' },
    )

    if (input.intervalMonths > 0) {
      // Logging the same job again moves the schedule it belongs to rather than
      // starting a second one beside it. Two rows called "gutter clean" on one
      // house is a calendar that double counts and nags twice.
      // Opened from a job, that job is the one, even if its wording was edited.
      const { rows } = input.serviceId
        ? { rows: [{ id: input.serviceId }] }
        : await db().query<{ id: string }>(
            `select id from home.service
              where asset_id = $1 and lower(title) = lower($2) and active = true
              limit 1`,
            [input.assetId, input.what],
          )

      await callTool(
        'home',
        'schedule_service',
        rows.length > 0
          ? {
              id: rows[0].id,
              interval_months: input.intervalMonths,
              last_done_on: input.doneOn,
              due_on: null,
            }
          : {
              asset_id: input.assetId,
              title: input.what,
              vendor_id: input.vendorId,
              interval_months: input.intervalMonths,
              last_done_on: input.doneOn,
            },
        { source: 'ui' },
      )
    }
    return done()
  } catch (error) {
    return failed(error)
  }
}

/**
 * Push a job out.
 *
 * Straight to SQL: it is one date on one row, reversible by snoozing again or
 * doing the job, and a tool for it would put a snooze button in the MCP surface
 * for no reason. There is no way here to make a job go away permanently, which
 * is the point: a snooze comes back.
 */
export async function snoozeService(id: string, days: number): Promise<ActionResult> {
  await requireOwner()
  try {
    await db().query(`update home.service set snooze_until = core.today() + $2::int where id = $1`, [
      id,
      Math.min(Math.max(Math.round(days), 1), 365),
    ])
    return done()
  } catch (error) {
    return failed(error)
  }
}

async function write(tool: string, input: unknown): Promise<ActionResult> {
  await requireOwner()
  try {
    // Through callTool so the form gets the tool's own validation, field by
    // field. A write from the UI is never guarded, so write_asset lands now.
    await callTool('home', tool, input, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

export type AssetInput = {
  id?: string
  kind?: 'property' | 'vehicle' | 'equipment'
  name?: string
  subtitle?: string
  value_cents?: number
  annual_cost_cents?: number
  acquired_on?: string | null
  notes?: string
  archived?: boolean
}
export async function saveAsset(input: AssetInput) {
  return write('write_asset', input)
}

export type ScheduleInput = {
  id?: string
  asset_id?: string
  title?: string
  vendor_id?: string | null
  interval_months?: number
  due_on?: string | null
  cost_estimate_cents?: number
  active?: boolean
}
export async function saveSchedule(input: ScheduleInput) {
  return write('schedule_service', input)
}

export type WarrantyInput = {
  id?: string
  asset_id?: string | null
  name?: string
  detail?: string
  cover?: string
  expires_on?: string | null
  document_url?: string
}
export async function saveWarranty(input: WarrantyInput) {
  return write('write_warranty', input)
}
