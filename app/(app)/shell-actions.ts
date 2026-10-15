'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireOwner } from '@/core/auth'
import { setSetting, type Settings } from '@/core/settings'

// Server actions are standalone POST endpoints addressed by id, so the (app)
// layout does not run for them and each one authenticates on its own.
//
// Theme and sidebar collapse used to be actions here; they moved to
// core/theme-client.ts, which writes the cookie and the DOM directly, so
// those two display preferences change with no server round trip.

// Tile ids are module ids and the core tile names, all short and lowercase;
// anything else is not a layout and is refused rather than stored.
const layoutSchema = z
  .object({
    order: z.array(z.string().regex(/^[a-z0-9_-]{1,40}$/)).max(40),
    hidden: z.array(z.string().regex(/^[a-z0-9_-]{1,40}$/)).max(40),
  })
  .nullable()

export type ActionResult = { ok: true } | { ok: false; error: string }

function failed(error: unknown): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : 'Failed' }
}

/** The key is fixed here: the client says what the layout is, not where it goes. */
export async function saveDashboardLayout(layout: Settings['dashboard_layout']): Promise<ActionResult> {
  await requireOwner()
  try {
    await setSetting('dashboard_layout', layoutSchema.parse(layout))
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (error) {
    return failed(error)
  }
}
