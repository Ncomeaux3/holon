import webpush, { WebPushError, type PushSubscription } from 'web-push'
import { db } from './db'

// Web push. The rules table has stored a `push` channel since the notifications
// step and the sender ignored it by decision; this is where that stops.
//
// VAPID keys are infrastructure, not an account credential, so they live in
// .env beside CRON_SECRET rather than in core.connections. Generate a pair with:
//   node -e "console.log(require('web-push').generateVAPIDKeys())"

export type Subscription = {
  id: string
  endpoint: string
  label: string
  failure_count: number
  last_sent_at: Date | null
}

/**
 * The public key the browser needs to subscribe, or null when push is not set up.
 *
 * Null rather than a throw: the Settings screen has to render and say push is
 * not configured, which is a different thing from a broken page.
 */
export function publicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null
}

function configure(): boolean {
  const publicVapid = process.env.VAPID_PUBLIC_KEY
  const privateVapid = process.env.VAPID_PRIVATE_KEY
  if (!publicVapid || !privateVapid) return false

  webpush.setVapidDetails(
    // A contact the push service can reach if this app misbehaves. The owner's
    // own address, which is what OWNER_EMAIL already is.
    process.env.VAPID_SUBJECT || `mailto:${process.env.OWNER_EMAIL ?? 'owner@example.com'}`,
    publicVapid,
    privateVapid,
  )
  return true
}

export async function listSubscriptions(): Promise<Subscription[]> {
  const { rows } = await db().query<Subscription>(
    `select id, endpoint, label, failure_count, last_sent_at
       from core.push_subscription order by created_at`,
  )
  return rows
}

/**
 * Store a browser's subscription.
 *
 * Upserts on the endpoint: re-subscribing on the same device returns the same
 * endpoint, and a second row would send every notification twice.
 */
export async function saveSubscription(
  subscription: PushSubscription,
  label: string,
): Promise<void> {
  await db().query(
    `insert into core.push_subscription (endpoint, p256dh, auth, label)
     values ($1, $2, $3, $4)
     on conflict (endpoint) do update
       set p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label,
           failure_count = 0`,
    [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, label],
  )
}

export async function removeSubscription(id: string): Promise<void> {
  await db().query(`delete from core.push_subscription where id = $1`, [id])
}

export type PushPayload = { title: string; body: string; url: string }

export type PushResult = {
  sent: number
  /** Subscriptions the push service said were gone, and which were deleted. */
  expired: number
  failed: number
  skipped?: string
}

/**
 * Send one notification to every subscribed device.
 *
 * One push per send, not one per item, for the same reason the digest is one
 * email: a flood is how notifications get turned off.
 *
 * A 404 or 410 means the browser unsubscribed or the push service dropped it.
 * That subscription is deleted rather than retried forever; anything else is
 * counted and left alone, because a push service having a bad minute is not a
 * reason to lose a device.
 */
export async function sendPush(payload: PushPayload): Promise<PushResult> {
  if (!configure()) return { sent: 0, expired: 0, failed: 0, skipped: 'VAPID keys are not set' }

  const subscriptions = await listSubscriptions()
  if (subscriptions.length === 0) {
    return { sent: 0, expired: 0, failed: 0, skipped: 'No device is subscribed' }
  }

  const { rows } = await db().query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    `select id, endpoint, p256dh, auth from core.push_subscription`,
  )

  let sent = 0
  let expired = 0
  let failed = 0

  for (const row of rows) {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        JSON.stringify(payload),
      )
      await db().query(
        `update core.push_subscription set last_sent_at = now(), failure_count = 0 where id = $1`,
        [row.id],
      )
      sent++
    } catch (error) {
      if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
        await db().query(`delete from core.push_subscription where id = $1`, [row.id])
        expired++
      } else {
        await db().query(
          `update core.push_subscription set failure_count = failure_count + 1 where id = $1`,
          [row.id],
        )
        failed++
      }
    }
  }

  return { sent, expired, failed }
}
