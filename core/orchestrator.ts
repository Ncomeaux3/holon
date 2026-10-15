import { db } from './db'
import { latestDigests } from './digests'

// Assembles the dashboard from digests and nothing else. It never reads a
// module's own tables, which is what lets it stay ignorant of all of them.
//
// The summary is built by rules. Only the one sentence at the top is written by
// a model, and if that call fails the summary still stands.

export type Alert = { title: string; detail?: string; tone: 'bad' | 'warn' | 'ok' }

export type Summary = {
  alerts: Alert[]
  failedJobs: { module: string; name: string }[]
  pendingProposals: number
  unreadNotifications: number
  spendCents: number
  capCents: number
  modules: { module: string; payload: Record<string, unknown> }[]
}

async function failedJobs(): Promise<Summary['failedJobs']> {
  const { rows } = await db().query<{ module: string; name: string }>(
    `select module, name from core.jobs where last_status = 'failed' order by module, name`,
  )
  return rows
}

async function counts(): Promise<{ proposals: number; unread: number }> {
  const { rows } = await db().query<{ proposals: string; unread: string }>(
    `select
       (select count(*) from core.proposals
         where status = 'pending'
           and (dismissed_until is null or dismissed_until < now()))::text as proposals,
       (select count(*) from core.notifications where read_at is null)::text as unread`,
  )
  return { proposals: Number(rows[0].proposals), unread: Number(rows[0].unread) }
}

async function spend(): Promise<{ spendCents: number; capCents: number }> {
  const { getSetting } = await import('./settings')
  const { rows } = await db().query<{ cents: string }>(
    `select coalesce(sum(cost_cents), 0)::text as cents
       from core.llm_calls where occurred_at >= date_trunc('month', now())`,
  )
  return { spendCents: Number(rows[0].cents), capCents: await getSetting('llm_soft_cap_cents') }
}

/**
 * The rules half. Deterministic, cheap, and the part that has to be right: a
 * failed job and a proposal waiting are facts, not judgements.
 */
export async function buildSummary(): Promise<Summary> {
  const [digests, failed, { proposals, unread }, { spendCents, capCents }] = await Promise.all([
    latestDigests(),
    failedJobs(),
    counts(),
    spend(),
  ])

  const alerts: Alert[] = []

  for (const job of failed) {
    alerts.push({
      title: `${job.module}.${job.name} failed`,
      detail: 'Check the Agent Log and retry it.',
      tone: 'bad',
    })
  }

  if (spendCents > capCents && capCents > 0) {
    alerts.push({
      title: 'Model spend is past the cap',
      detail: `$${(spendCents / 100).toFixed(2)} against $${(capCents / 100).toFixed(2)}. Research runs are refused until next month.`,
      tone: 'warn',
    })
  }

  if (proposals > 0) {
    alerts.push({
      title: `${proposals} ${proposals === 1 ? 'proposal is' : 'proposals are'} waiting`,
      detail: 'Nothing was written. Review decides.',
      tone: 'warn',
    })
  }

  return {
    alerts,
    failedJobs: failed,
    pendingProposals: proposals,
    unreadNotifications: unread,
    spendCents,
    capCents,
    modules: digests.map((d) => ({ module: d.module, payload: d.payload })),
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The one sentence at the top, built from the summary.
 *
 * This was a Haiku call. It is a template now, for two reasons that both beat
 * the prose: it cannot invent a number on the most read sentence in the app,
 * and it costs nothing, so it works with no provider connected and never
 * counts against the spend cap.
 *
 * Returns null when there is nothing worth a sentence. A dashboard with no
 * headline is a quiet night, which is the correct output.
 */
export function writeHeadline(summary: Summary, today?: string): string | null {
  const segments = headlineSegments(summary, today)
  return segments.length === 0 ? null : segments.map((s) => s.text).join('')
}

/** A run of the headline, with where it points when it points anywhere. */
export type HeadlineSegment = { text: string; href?: string }

/**
 * The headline in pieces, so the dashboard can link the parts of the sentence
 * that name something you can go and look at.
 *
 * The artboard underlines those runs in accent and leaves the joining words
 * alone, which is why the separators are segments of their own rather than
 * something the caller has to reconstruct. `writeHeadline` joins them back
 * into the plain string that goes in the database and the email.
 */
export function headlineSegments(summary: Summary, today?: string): HeadlineSegment[] {
  const digested = digestSentence(summary, today)
  if (digested.length > 0) return [...digested, ...capSentence(summary)]

  const parts: HeadlineSegment[] = []

  const bad = summary.alerts.filter((a) => a.tone === 'bad').length
  const other = summary.alerts.length - bad
  if (bad > 0) {
    parts.push({ text: `${plural(bad, 'thing')} needing attention`, href: '/notifications' })
  }
  if (other > 0) parts.push({ text: plural(other, 'warning'), href: '/notifications' })
  if (summary.failedJobs.length > 0) {
    parts.push({ text: plural(summary.failedJobs.length, 'failed job'), href: '/agent-log' })
  }
  if (summary.pendingProposals > 0) {
    parts.push({ text: `${plural(summary.pendingProposals, 'proposal')} waiting`, href: '/review' })
  }

  if (parts.length === 0) return []

  const out: HeadlineSegment[] = []
  parts.forEach((part, i) => {
    if (i > 0) out.push({ text: i === parts.length - 1 ? ' and ' : ', ' })
    out.push({ ...part, text: i === 0 ? capitalise(part.text) : part.text })
  })
  out.push({ text: '.' })

  return [...out, ...capSentence(summary)]
}

/**
 * The cap is the one number worth naming unprompted: it is the only thing
 * here that stops working when it is reached.
 */
function capSentence(summary: Summary): HeadlineSegment[] {
  if (!(summary.capCents > 0 && summary.spendCents >= summary.capCents)) return []
  return [
    { text: ' Model spend has reached the ' },
    { text: `${(summary.capCents / 100).toFixed(2)} cap`, href: '/settings' },
    { text: ', so research is paused.' },
  ]
}

/**
 * The artboard's sentence, from digests: "Net worth climbed $4,180 in 30
 * days. Dining and Fitness are past 80% of budget with 19 days left, and
 * Negotiation has gone 74 days without a linked event."
 *
 * Each clause is there only when its digest carries the number, and the
 * period is the one the digest measures: Finance's change is over thirty
 * days, so the sentence says so rather than borrowing the artboard's "this
 * month". Nothing here attributes the move to an account, because no digest
 * does. Empty when no clause has a number, and the alerts sentence stands in.
 */
function digestSentence(summary: Summary, today?: string): HeadlineSegment[] {
  const payload = (id: string) => summary.modules.find((m) => m.module === id)?.payload
  const num = (p: Record<string, unknown> | undefined, key: string) =>
    typeof p?.[key] === 'number' ? (p[key] as number) : null
  const finance = payload('finance')
  const skills = payload('skills')
  const now = today ? new Date(`${today}T12:00:00Z`) : new Date()

  const first: HeadlineSegment[] = []
  const change = num(finance, 'changeCents')
  if (change !== null) {
    const dollars = `$${Math.round(Math.abs(change) / 100).toLocaleString('en-US')}`
    first.push(
      change === 0
        ? { text: 'Net worth held over 30 days' }
        : { text: `Net worth ${change > 0 ? 'climbed' : 'fell'} ` },
    )
    if (change !== 0) first.push({ text: `${dollars} in 30 days`, href: '/finance' })
  }

  const rest: HeadlineSegment[][] = []
  const over = ((finance?.overBudget as { name: string }[] | undefined) ?? []).map((b) => b.name)
  if (over.length > 0) {
    const names =
      over.length === 1 ? over[0] : `${over.slice(0, -1).join(', ')} and ${over[over.length - 1]}`
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    const daysLeft = Math.round((last.getTime() - now.getTime()) / 86_400_000)
    const threshold = num(finance, 'alertThreshold') ?? 80
    rest.push([
      { text: `${names} ${over.length === 1 ? 'is' : 'are'} past ${threshold}%`, href: '/finance' },
      { text: ` of budget with ${plural(daysLeft, 'day')} left` },
    ])
  }

  const idle = ((skills?.stagnant as { name: string; lastEventAt: string | null }[] | undefined) ?? [])
    .find((s) => s.lastEventAt)
  if (idle?.lastEventAt) {
    const days = Math.round((now.getTime() - Date.parse(idle.lastEventAt)) / 86_400_000)
    rest.push([
      { text: `${idle.name} has gone ${plural(days, 'day')}`, href: '/skills' },
      { text: ' without a linked event' },
    ])
  }

  if (first.length === 0 && rest.length === 0) return []

  const out: HeadlineSegment[] = []
  if (first.length > 0) out.push(...first, { text: '.' })
  rest.forEach((clause, i) => {
    if (i === 0 && first.length > 0) out.push({ text: ' ' })
    if (i > 0) out.push({ text: ', and ' })
    const [head, ...tail] = clause
    out.push(i === 0 ? { ...head, text: capitalise(head.text) } : head, ...tail)
  })
  if (rest.length > 0) out.push({ text: '.' })
  return out
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Writes one core.dashboard_summary row and queues at most one notification.
 *
 * One, not one per alert: the sender bundles anyway, and queueing per alert
 * would make the unread count on the warnings tile grow by however many things
 * happened to be wrong rather than by how many nights have passed.
 *
 * A night with nothing wrong still queues one row, "Nothing needs you today",
 * decided 2026-09-14: from the inbox, silence and a broken cron look the same.
 */
export async function assembleSummary(): Promise<{ headline: string | null; queued: boolean }> {
  const summary = await buildSummary()
  const { ownerToday } = await import('./today')
  const headline = writeHeadline(summary, await ownerToday())

  await db().query(
    `insert into core.dashboard_summary (summary, headline) values ($1::jsonb, $2)`,
    [JSON.stringify(summary), headline],
  )

  const { queue } = await import('./notify')
  const quiet = summary.alerts.length === 0
  const worst = summary.alerts.find((a) => a.tone === 'bad') ?? summary.alerts[0]

  // A digest that has not been sent or read yet is superseded by this one
  // rather than stacked beside it. Without this, pressing Run now four times
  // puts four near-identical warnings on the dashboard, and a week of unread
  // nights would bury whatever is actually new.
  //
  // Sent ones stay: those are history. Module alerts use the default channel
  // and are never touched by this.
  await db().query(
    `delete from core.notifications
      where channel = 'digest' and sent_at is null and read_at is null`,
  )

  await queue({
    channel: 'digest',
    title: quiet ? 'Nothing needs you today' : (headline ?? worst.title),
    body: quiet
      ? (headline ?? '')
      : summary.alerts.map((a) => `${a.title}${a.detail ? `. ${a.detail}` : ''}`).join('\n'),
    urgency: summary.alerts.some((a) => a.tone === 'bad') ? 'urgent' : 'normal',
    href: '/notifications',
  })

  return { headline, queued: true }
}

export async function getDashboardHeadline(): Promise<string | null> {
  const { rows } = await db().query<{ headline: string | null }>(
    `select headline from core.dashboard_summary order by run_at desc limit 1`,
  )
  return rows[0]?.headline ?? null
}

export type LatestSummary = {
  runAt: Date
  headline: string | null
  summary: Summary
  notifiedAt: Date | null
} | null

export async function latestSummary(): Promise<LatestSummary> {
  const { rows } = await db().query<{
    run_at: Date
    headline: string | null
    summary: Summary
    notified_at: Date | null
  }>(
    `select run_at, headline, summary, notified_at
       from core.dashboard_summary order by run_at desc limit 1`,
  )
  if (rows.length === 0) return null
  return {
    runAt: rows[0].run_at,
    headline: rows[0].headline,
    summary: rows[0].summary,
    notifiedAt: rows[0].notified_at,
  }
}

