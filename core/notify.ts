import { db } from './db'
import type { Rule, RulePatch } from './notification-rules'

// Everything that wants your attention becomes a row here, and the nightly
// sender bundles the lot into one plain text email. One email a day, never a
// flood: that is the whole design.

export type Urgency = 'normal' | 'urgent'

export async function queue(args: {
  title: string
  body: string
  channel?: string
  urgency?: Urgency
  dueAt?: Date
  /** Where the dashboard row goes. Empty opens the alert centre. */
  href?: string
}): Promise<void> {
  await db().query(
    `insert into core.notifications (channel, title, body, due_at, urgency, href)
     values ($1, $2, $3, coalesce($4, now()), $5, $6)`,
    [
      args.channel ?? 'email',
      args.title,
      args.body,
      args.dueAt ?? null,
      args.urgency ?? 'normal',
      args.href ?? null,
    ],
  )
}

export type Pending = {
  id: string
  title: string
  body: string
  urgency: string
  channel: string
}

/**
 * Quiet hours wrap midnight, so "inside" is a union of two ranges when from is
 * later than to. 22:00 to 06:30 is the overnight window, not an empty one.
 *
 * Takes minutes since midnight rather than a Date, and deliberately. It used to
 * take a Date and read `getHours()`, which is the *server's* clock: on Vercel
 * that is UTC, so an owner in Chicago had their quiet hours checked against a
 * window five or six hours out. The caller resolves the timezone through
 * minutesIn() and this stays pure, which is also what makes it testable
 * without depending on the machine the test runs on.
 */
export function inQuietHours(minutes: number, from: string, to: string): boolean {
  const at = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number)
    return h * 60 + m
  }
  const start = at(from)
  const end = at(to)
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end
}

/**
 * Due, unsent, not snoozed, and allowed out right now.
 *
 * Three gates, in order of bluntness: the global pause, then the rule's own
 * mute or snooze, then quiet hours. A row held by any of them stays queued and
 * goes out on a later run, which is what makes snooze mean "later" rather than
 * "never".
 */
export async function pending(): Promise<Pending[]> {
  const { getSettings } = await import('./settings')
  const settings = await getSettings()
  if (settings.notifications_paused) return []

  const { rows } = await db().query<Pending>(
    `select n.id, n.title, n.body, n.urgency, n.channel
       from core.notifications n
       left join core.notification_rules r on r.id = n.rule_id
      where n.sent_at is null
        and n.due_at <= now()
        and (n.snooze_until is null or n.snooze_until < now())
        and coalesce(r.muted, false) = false
        and (r.snooze_until is null or r.snooze_until < now())
      order by (n.urgency = 'urgent') desc, n.due_at`,
  )

  const { minutesIn } = await import('./today')
  if (!inQuietHours(minutesIn(new Date(), settings.timezone), settings.quiet_from, settings.quiet_to)) {
    return rows
  }

  // Inside quiet hours: the daily digest still goes, everything else waits.
  //
  // The digest is exempt because it is the thing the owner asked to receive,
  // not an interruption, and because holding it would mean never sending it.
  // There is one cron run a day and it fires at 03:00 or 04:00 local, which is
  // inside any sensible overnight window: a digest held for "later" would find
  // that later is tomorrow's run, also inside the window, forever.
  //
  // Urgent still gets through on the override, as before.
  return rows.filter(
    (r) => r.channel === 'digest' || (settings.quiet_urgent_override && r.urgency === 'urgent'),
  )
}

/**
 * The digest email. Plain text on purpose: it reads in two seconds on a phone
 * and there is nothing in it worth a layout.
 */
export function renderEmail(headline: string | null, items: Pending[], spendCents: number): string {
  const lines: string[] = []

  if (headline) lines.push(headline, '')

  if (items.length === 0) {
    lines.push('Nothing needs you today.')
  } else {
    for (const item of items.slice(0, 3)) {
      lines.push(`${item.urgency === 'urgent' ? '! ' : ''}${item.title}`)
      if (item.body) lines.push(`  ${item.body}`)
    }
    if (items.length > 3) lines.push('', `and ${items.length - 3} more.`)
  }

  lines.push('', `Model spend this month: $${(spendCents / 100).toFixed(2)}`)
  return lines.join('\n')
}

async function spendThisMonthCents(): Promise<number> {
  const { rows } = await db().query<{ cents: string }>(
    `select coalesce(sum(cost_cents), 0)::text as cents
       from core.llm_calls where occurred_at >= date_trunc('month', now())`,
  )
  return Number(rows[0].cents)
}

export type SendResult = { sent: number; emails: number; skipped?: string }

/**
 * Sends one email for however many notifications are waiting, then marks them
 * all. Bundling is the point: N alerts is still one email.
 *
 * Two different outcomes, deliberately:
 *
 * Not configured is a skip. No Resend key, no OWNER_EMAIL: the rows stay unsent
 * and go out on the next run once it is set up. Nothing is lost and nothing is
 * wrong yet.
 *
 * A send that was attempted and refused is a failure, and it throws. The job
 * runner records it, the orchestrator raises it as an alert, and it shows on
 * the dashboard. A digest that silently stopped arriving is the one failure
 * mode this system cannot afford, because you would not notice.
 */
export async function sendPending(): Promise<SendResult> {
  const items = await pending()
  if (items.length === 0) return { sent: 0, emails: 0 }

  const [{ getDashboardHeadline }, { sendEmail, sendingAllowed }] = await Promise.all([
    import('./orchestrator'),
    import('@/integrations/resend/client'),
  ])

  // A skip, not a failure, and for the same reason as an unset OWNER_EMAIL: the
  // rows stay queued, and a local run is not a broken one.
  if (!sendingAllowed()) {
    return { sent: 0, emails: 0, skipped: 'Email sending is off outside production' }
  }

  const { getSetting } = await import('./settings')
  const to = (await getSetting('digest_email')) || process.env.OWNER_EMAIL
  if (!to) {
    return { sent: 0, emails: 0, skipped: 'No digest_email setting and no OWNER_EMAIL' }
  }

  const headline = await getDashboardHeadline()
  const body = renderEmail(headline, items, await spendThisMonthCents())

  try {
    await sendEmail({ to, subject: headline ?? 'Your daily digest', text: body })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'send failed'
    // Not connected yet is not a failure; anything else is.
    if (/not connected/i.test(message)) return { sent: 0, emails: 0, skipped: message }
    throw new Error(`Digest email refused: ${message}`)
  }

  // The same bundle, pushed once, to whatever devices are subscribed. Only
  // when a rule that raised something actually asks for push: the channel has
  // been storable since the notifications step and honouring it is the whole
  // point of this.
  if (await anyRuleWantsPush(items.map((i) => i.id))) {
    const { renderPush } = await import('./push-shape')
    const { sendPush } = await import('./push')
    const push = renderPush(items.map((i) => ({ title: i.title, urgency: i.urgency })))
    if (push) await sendPush({ ...push, url: '/' })
  }

  await db().query(`update core.notifications set sent_at = now() where id = any($1)`, [
    items.map((i) => i.id),
  ])

  return { sent: items.length, emails: 1 }
}

/**
 * Whether any of these came from a rule with push turned on.
 *
 * A notification with no rule behind it does not push. Those are raised by a
 * job rather than by a rule the owner configured, and pushing them would mean
 * the one channel nobody can ignore is the one channel nobody chose.
 */
async function anyRuleWantsPush(ids: string[]): Promise<boolean> {
  if (ids.length === 0) return false
  const { rows } = await db().query<{ n: string }>(
    `select count(*)::text as n
       from core.notifications n
       join core.notification_rules r on r.id = n.rule_id
      where n.id = any($1) and 'push' = any(r.channels)`,
    [ids],
  )
  return Number(rows[0].n) > 0
}

// The alert centre ----------------------------------------------------------

export type Alert = {
  id: string
  title: string
  body: string
  channel: string
  urgency: string
  module: string | null
  rule_label: string | null
  due_at: Date
  read_at: Date | null
}

/**
 * Everything that has been raised, newest first, with the rule that raised it.
 * The screen splits this into unread and history rather than asking twice.
 */
export async function listAlerts(limit = 60): Promise<Alert[]> {
  // A snoozed row is out until the snooze ends, as it is on the dashboard:
  // the Notifications row's left swipe snoozes, and a row that came straight
  // back as unread would read as a swipe that did nothing.
  const { rows } = await db().query<Alert>(
    `select n.id, n.title, n.body, n.channel, n.urgency, n.due_at, n.read_at,
            r.module, r.label as rule_label
       from core.notifications n
       left join core.notification_rules r on r.id = n.rule_id
      where n.due_at <= now()
        and (n.snooze_until is null or n.snooze_until < now())
      order by n.due_at desc
      limit $1`,
    [limit],
  )
  return rows
}

/**
 * The dashboard's warnings tile: unread, not snoozed, worst first. Snoozed is
 * neither read nor sent, so the row is back the day the snooze ends.
 */
export async function unreadWarnings(limit = 4) {
  const { rows } = await db().query<{
    id: string
    title: string
    body: string
    urgency: string
    href: string | null
  }>(
    `select id, title, body, urgency, href from core.notifications
      where read_at is null and (snooze_until is null or snooze_until < now())
      order by (urgency = 'urgent') desc, due_at desc limit $1`,
    [limit],
  )
  return rows
}

/** Zero days clears the snooze. */
export async function snoozeNotification(id: string, days: number): Promise<void> {
  await db().query(
    `update core.notifications
        set snooze_until = case when $2 = 0 then null else now() + make_interval(days => $2) end
      where id = $1`,
    [id, days],
  )
}

export async function markRead(id: string): Promise<void> {
  await db().query(`update core.notifications set read_at = now() where id = $1`, [id])
}

export async function markAllRead(): Promise<void> {
  await db().query(`update core.notifications set read_at = now() where read_at is null`)
}

// The rules behind the sends ------------------------------------------------
//
// core/notification-rules.ts holds the shape and the derived state, because the
// Notifications screen is a client component and cannot reach `pg`. These are
// the queries over that shape, and they stay here on the server side of the
// line.

export async function listRules(): Promise<Rule[]> {
  const { rows } = await db().query<Rule & { lead_days: string }>(
    `select id, module, key, label, trigger_text, channels, timing, lead_days,
            urgent, muted, snooze_until, sample_title, sample_body, position
       from core.notification_rules
      order by position, module, key`,
  )
  return rows.map((r) => ({ ...r, lead_days: Number(r.lead_days) }))
}

/**
 * The columns a patch is allowed to name. This is not the RulePatch type
 * restated for tidiness: the type is erased at runtime, this function builds a
 * SET clause by interpolating key names, and it is reached from a server
 * action, which is a public POST endpoint that accepts whatever it is sent. A
 * key of `muted = true, label` would otherwise write a column no caller should
 * be able to touch.
 */
const PATCHABLE: (keyof RulePatch)[] = [
  'channels',
  'timing',
  'lead_days',
  'urgent',
  'muted',
  'snooze_until',
]

export async function patchRule(id: string, patch: RulePatch): Promise<void> {
  const fields = PATCHABLE.filter((f) => f in patch)
  if (fields.length === 0) return

  const set = fields.map((f, i) => `${f} = $${i + 2}`).join(', ')
  await db().query(`update core.notification_rules set ${set} where id = $1`, [
    id,
    ...fields.map((f) => patch[f]),
  ])
}

/**
 * Undo pauses the rule that produced a write for seven days, so the same
 * decision is not made again tomorrow night.
 */
export async function snoozeRule(id: string, days: number): Promise<void> {
  await db().query(
    `update core.notification_rules
        set snooze_until = now() + make_interval(days => $2), muted = false
      where id = $1`,
    [id, days],
  )
}

/** The avatar menu's badge: raised and not yet read, the screen's unread list counted. */
export async function countUnread(): Promise<number> {
  const { rows } = await db().query<{ count: string }>(
    `select count(*)::text as count from core.notifications
      where read_at is null and due_at <= now()
        and (snooze_until is null or snooze_until < now())`,
  )
  return Number(rows[0]?.count ?? 0)
}
