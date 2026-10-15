'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireOwner } from '@/core/auth'
import type { Channel } from '@/core/notification-rules'
import { listRules, patchRule } from '@/core/notify'
import { setSetting, type SettingKey, type Settings } from '@/core/settings'

// Server actions are standalone POST endpoints addressed by id, so the (app)
// layout does not run for them and each one authenticates independently.

export type ActionResult = { ok: true } | { ok: false; error: string }

function done(): ActionResult {
  revalidatePath('/settings/notifications')
  revalidatePath('/notifications')
  revalidatePath('/', 'layout')
  return { ok: true }
}

function failed(error: unknown): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : 'Failed' }
}

const CHANNELS: Channel[] = ['push', 'email', 'inapp']

/**
 * Turn a channel on or off for every rule in one module. The grid's cell is a
 * rollup, so the write it makes has to be one too.
 */
export async function setModuleChannel(
  module: string,
  channel: Channel,
  on: boolean,
): Promise<ActionResult> {
  await requireOwner()
  if (!CHANNELS.includes(channel)) return { ok: false, error: `${channel} is not a channel` }

  try {
    const rules = (await listRules()).filter((r) => r.module === module)
    for (const rule of rules) {
      const has = rule.channels.includes(channel)
      if (has === on) continue
      await patchRule(rule.id, {
        channels: on ? [...rule.channels, channel] : rule.channels.filter((c) => c !== channel),
      })
    }
    return done()
  } catch (error) {
    return failed(error)
  }
}

/** The Channels strip: one channel onto or off every rule there is. */
export async function setChannelEverywhere(channel: Channel, on: boolean): Promise<ActionResult> {
  await requireOwner()
  if (!CHANNELS.includes(channel)) return { ok: false, error: `${channel} is not a channel` }

  try {
    for (const rule of await listRules()) {
      const has = rule.channels.includes(channel)
      if (has === on) continue
      await patchRule(rule.id, {
        channels: on ? [...rule.channels, channel] : rule.channels.filter((c) => c !== channel),
      })
    }
    return done()
  } catch (error) {
    return failed(error)
  }
}

/**
 * Batching for a whole module. On means the morning digest, because that is the
 * one every module has; a rule that should land in the evening is set on the
 * Notifications screen, and turning batching off here leaves it immediate.
 */
export async function setModuleDigest(module: string, on: boolean): Promise<ActionResult> {
  await requireOwner()
  try {
    const rules = (await listRules()).filter((r) => r.module === module)
    for (const rule of rules) {
      const batched = rule.timing !== 'immediate'
      if (batched === on) continue
      await patchRule(rule.id, { timing: on ? 'morning' : 'immediate' })
    }
    return done()
  } catch (error) {
    return failed(error)
  }
}

/**
 * The keys this tab owns. A server action accepts whatever it is sent and the
 * type parameter is erased at runtime, so without this the quiet hours card
 * would be a general purpose write to any setting.
 */
const QUIET_KEYS = ['quiet_from', 'quiet_to', 'quiet_urgent_override'] as const satisfies
  readonly SettingKey[]

type QuietKey = (typeof QUIET_KEYS)[number]

export async function setQuiet<K extends QuietKey>(
  key: K,
  value: Settings[K],
): Promise<ActionResult> {
  await requireOwner()
  if (!(QUIET_KEYS as readonly string[]).includes(key)) {
    return { ok: false, error: `${key} is not a quiet hours setting` }
  }
  try {
    await setSetting(key, value)
    return done()
  } catch (error) {
    return failed(error)
  }
}

/**
 * Store a browser's push subscription.
 *
 * The shape is validated here rather than trusted: this is a public POST
 * endpoint like every server action, and what it writes is used to make
 * outbound requests. A malformed endpoint would be a request to somewhere of
 * the caller's choosing.
 */
export async function subscribeDevice(
  subscription: unknown,
  userAgent: string,
): Promise<ActionResult> {
  await requireOwner()

  const parsed = z
    .object({
      endpoint: z.url().max(2000),
      keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
    })
    .safeParse(subscription)

  if (!parsed.success) return { ok: false, error: 'That is not a push subscription' }
  if (!/^https:\/\//.test(parsed.data.endpoint)) {
    return { ok: false, error: 'A push endpoint has to be https' }
  }

  try {
    const { saveSubscription } = await import('@/core/push')
    await saveSubscription(parsed.data, deviceLabel(userAgent))
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function forgetDevice(id: string): Promise<ActionResult> {
  await requireOwner()
  try {
    const { removeSubscription } = await import('@/core/push')
    await removeSubscription(id)
    return done()
  } catch (error) {
    return failed(error)
  }
}

/**
 * A user agent string, shortened to the part a person recognises.
 *
 * Not parsed properly on purpose: this only has to let the owner tell the
 * laptop from the phone when they press Forget, and a user agent library for
 * that would be a dependency for one line of text.
 */
function deviceLabel(userAgent: string): string {
  const os = /iPhone|iPad/.test(userAgent)
    ? 'iPhone'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Macintosh/.test(userAgent)
        ? 'Mac'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : 'Browser'

  const browser = /Firefox/.test(userAgent)
    ? 'Firefox'
    : /Edg\//.test(userAgent)
      ? 'Edge'
      : /Chrome/.test(userAgent)
        ? 'Chrome'
        : /Safari/.test(userAgent)
          ? 'Safari'
          : ''

  return browser ? `${os}, ${browser}` : os
}
