import { db } from '@/core/db'
import { queue } from '@/core/notify'
import { arrivals, latestMetrics, thisWeek } from '../data'
import { load } from '../units'

export type FitnessDigest = {
  workoutsThisWeek: number
  minutesThisWeek: number
  /** The crude, honest load figure. See units.ts. */
  loadThisWeek: number
  loadLastWeek: number
  /** Days since the last workout of any kind. Null when there has never been one. */
  daysSinceLast: number | null
  latest: { kind: string; value: number; measuredOn: string }[]
}

export async function nightlyDigest(): Promise<FitnessDigest> {
  const [week, metrics] = await Promise.all([thisWeek(), latestMetrics()])

  const { rows: previous } = await db().query<{ kind: string; duration_s: number }>(
    `select kind, duration_s from fitness.workout
      where started_at >= core.today() - 14 and started_at < core.today() - 7`,
  )

  const { rows: last } = await db().query<{ days: number | null }>(
    `select (core.today() - max(started_at)::date)::int as days from fitness.workout`,
  )

  return {
    workoutsThisWeek: week.length,
    minutesThisWeek: Math.round(week.reduce((sum, w) => sum + w.duration_s, 0) / 60),
    loadThisWeek: load(week.map((w) => ({ kind: w.kind, durationS: w.duration_s }))),
    loadLastWeek: load(previous.map((w) => ({ kind: w.kind, durationS: w.duration_s }))),
    daysSinceLast: last[0]?.days ?? null,
    latest: metrics.map((m) => ({
      kind: m.kind,
      value: Number(m.value),
      measuredOn: m.measured_on,
    })),
  }
}

const TITLE = 'Apple Health is not getting through'

/**
 * A nightly job of its own, not part of the digest: get_digest is recomputed
 * after every write tool, and this must queue at most once a night. Default
 * channel, because the orchestrator deletes unsent digest-channel rows.
 */
export async function appleAlert(): Promise<{ queued: boolean }> {
  const [a, { rows }] = await Promise.all([
    arrivals(),
    db().query(`select 1 from core.connections where integration_id = 'health_auto_export'`),
  ])
  const quiet =
    rows.length > 0 &&
    (!a.lastAccepted || Date.now() - new Date(a.lastAccepted).getTime() > 2 * 86_400_000)
  if (a.rejected === 0 && !quiet) return { queued: false }
  // Run now and Retry run the jobs again and queue() has no dedupe, so one
  // unsent alert, or one in the last 20 hours, is enough.
  const { rows: already } = await db().query(
    `select 1 from core.notifications
      where title = $1 and (sent_at is null or created_at > now() - interval '20 hours')`,
    [TITLE],
  )
  if (already.length > 0) return { queued: false }
  await queue({
    title: TITLE,
    body:
      a.rejected > 0
        ? `${a.rejected} ${a.rejected === 1 ? 'post' : 'posts'} rejected since the last accepted one. Check the secret in both Health Auto Export automations.`
        : 'Nothing accepted from the phone in over 2 days. Check that both Health Auto Export automations still run.',
    href: '/settings/connections',
  })
  return { queued: true }
}
