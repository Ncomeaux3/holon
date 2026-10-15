import { db } from '@/core/db'
import { listScreenings } from '../data'
import { screeningStatus } from '../screening'

export type HealthDigest = {
  /** Appointments in the next thirty days. */
  upcoming: { what: string; startsAt: string; prep: string }[]
  /** Screenings that are late, or due inside two months. */
  screeningsDue: { name: string; status: string }[]
  /** Prescriptions to reorder in the next fortnight. */
  refillsDue: { name: string; refillOn: string }[]
  medications: number
}

export async function nightlyDigest(): Promise<HealthDigest> {
  const { rows: upcoming } = await db().query<{
    what: string
    starts_at: Date
    prep: string
  }>(
    `select what, starts_at, prep from health.appointment
      where status in ('confirmed', 'held')
        and starts_at between now() and now() + interval '30 days'
      order by starts_at`,
  )

  const { rows: refills } = await db().query<{ name: string; refill_on: string }>(
    `select name, refill_on::text from health.medication
      where ended_on is null and refill_on is not null
        and refill_on <= core.today() + 14
      order by refill_on`,
  )

  const { rows: countRows } = await db().query<{ n: string }>(
    `select count(*)::text as n from health.medication where ended_on is null`,
  )

  const { rows: todayRows } = await db().query<{ today: string }>(
    `select core.today()::text as today`,
  )
  const today = todayRows[0].today

  const screenings = await listScreenings()

  return {
    upcoming: upcoming.map((a) => ({
      what: a.what,
      startsAt: new Date(a.starts_at).toISOString(),
      // The thing that is useless the day after and vital the day before.
      prep: a.prep,
    })),
    screeningsDue: screenings
      .map((s) => ({
        name: s.name,
        status: screeningStatus(
          {
            intervalMonths: s.interval_months,
            lastDoneOn: s.last_done_on,
            snoozeUntil: s.snooze_until,
          },
          today,
        ),
      }))
      // 'never' is included: a screening you have never had is exactly the one
      // worth a line in a digest.
      .filter((s) => ['overdue', 'due', 'soon', 'never'].includes(s.status)),
    refillsDue: refills.map((r) => ({ name: r.name, refillOn: r.refill_on })),
    medications: Number(countRows[0].n),
  }
}
