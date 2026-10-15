'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
import type { RulePatch } from '@/core/notification-rules'
import { markAllRead, markRead, patchRule, snoozeNotification, snoozeRule } from '@/core/notify'
import { setSetting, type SettingKey, type Settings } from '@/core/settings'

// Server actions are standalone POST endpoints addressed by id, so the (app)
// layout does not run for them and each one authenticates independently.

export type ActionResult = { ok: true } | { ok: false; error: string }

function failed(error: unknown): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : 'Failed' }
}

function done(): ActionResult {
  revalidatePath('/notifications')
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function updateRule(id: string, patch: RulePatch): Promise<ActionResult> {
  await requireOwner()
  try {
    await patchRule(id, patch)
    return done()
  } catch (error) {
    return failed(error)
  }
}

/** Snoozing clears a mute: the two states are exclusive, as the screen shows. */
export async function snooze(id: string, days: number): Promise<ActionResult> {
  await requireOwner()
  try {
    if (days === 0) await patchRule(id, { snooze_until: null })
    else await snoozeRule(id, days)
    return done()
  } catch (error) {
    return failed(error)
  }
}

/** One alert, not its rule: the dashboard's Snooze holds this row only. */
export async function snoozeAlert(id: string, days: number): Promise<ActionResult> {
  await requireOwner()
  try {
    await snoozeNotification(id, days)
    return done()
  } catch (error) {
    return failed(error)
  }
}

/**
 * The keys this screen owns. A server action is a public POST endpoint that
 * accepts whatever it is sent, and the type parameter is erased at runtime, so
 * without this the schedule card would be a general purpose write to any
 * setting, including agent_autonomy and the model spend cap.
 */
const SCHEDULE_KEYS = [
  'digest_morning_enabled',
  'digest_evening_at',
  'digest_evening_enabled',
  'quiet_from',
  'quiet_to',
  'quiet_urgent_override',
  'notifications_paused',
] as const satisfies readonly SettingKey[]

type ScheduleKey = (typeof SCHEDULE_KEYS)[number]

/** The schedule card. One key at a time, so a failed save loses one field. */
export async function updateSchedule<K extends ScheduleKey>(
  key: K,
  value: Settings[K],
): Promise<ActionResult> {
  await requireOwner()
  if (!(SCHEDULE_KEYS as readonly string[]).includes(key)) {
    return { ok: false, error: `${key} is not a notification setting` }
  }
  try {
    await setSetting(key, value)
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function readAlert(id: string): Promise<ActionResult> {
  await requireOwner()
  try {
    await markRead(id)
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function readAllAlerts(): Promise<ActionResult> {
  await requireOwner()
  try {
    await markAllRead()
    return done()
  } catch (error) {
    return failed(error)
  }
}
