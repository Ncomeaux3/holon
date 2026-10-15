'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireOwner } from '@/core/auth'
import { calendarItems } from '@/core/calendar-registry'
import type { CalendarItem } from '@/core/module-contract'
import { db } from '@/core/db'
import { syncModule } from '@/core/sync'
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

async function run(tool: string, input: unknown): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('calendar', tool, input, { source: 'ui' })
    revalidatePath('/calendar')
    return { ok: true }
  } catch (error) {
    return failed(error)
  }
}

export type EventDraft = {
  id?: string
  title: string
  on_date: string
  all_day: boolean
  starts: string | null
  ends: string | null
  location: string
}

export const saveEvent = async (input: EventDraft) => run('write_event', input)
export const removeEvent = async (id: string) => run('delete_event', { id })
export const saveHidden = async (hidden: string[]) => run('set_hidden', { hidden })

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/**
 * A month and a week each side is what the screen asks for. Bounded, because
 * every module projects its repeats across the whole span: a monthly charge
 * over ten thousand years is a lot of rows to build for one request.
 */
const RANGE = z
  .object({ from: date, to: date })
  .refine((r) => r.to >= r.from && Date.parse(r.to) - Date.parse(r.from) <= 62 * 86_400_000, {
    message: 'A range is at most 62 days',
  })

/** A month the page did not render: the grid asks for it when you page to it. */
export async function itemsFor(range: { from: string; to: string }): Promise<CalendarItem[]> {
  await requireOwner()
  return calendarItems(RANGE.parse(range))
}

/** Pull every feed now. The nightly job and this write the same core.jobs rows. */
export async function syncCalendar(): Promise<{ ran: number; failed: string[]; detail?: string }> {
  await requireOwner()
  const result = await syncModule('calendar')
  revalidatePath('/calendar')
  // Each pull's own line ("40 events from 2 calendars, 1 removed") as the
  // toast. A feed that is not connected says it skipped, and saying so beside
  // the one that ran would read as a failure, so only the ones that ran speak.
  const { rows } = await db().query<{ detail: string | null }>(
    `select log #>> '{output,detail}' as detail from core.jobs
      where module = 'calendar' and name like 'pull\\_%' and log #>> '{output,skipped}' = 'false'
      order by name`,
  )
  const detail = rows
    .map((r) => r.detail)
    .filter(Boolean)
    .join(' ')
  return { ...result, ...(detail && { detail }) }
}
