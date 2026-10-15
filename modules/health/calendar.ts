import { db } from '@/core/db'
import type { CalendarItem } from '@/core/module-contract'

// What Health puts on the Calendar: timed appointments, and the day a
// medication is next due for a refill. health.appointment has no end column,
// so an appointment carries no endsAt.

const TZ = `coalesce((select value #>> '{}' from core.settings where key = 'timezone'), 'UTC')`

export type AppointmentRow = {
  id: string
  what: string
  provider_name: string | null
  status: string
  /** YYYY-MM-DDTHH:MM in the owner's zone. */
  starts_local: string
}

export function appointmentItems(
  rows: AppointmentRow[],
  range: { from: string; to: string },
): CalendarItem[] {
  return rows
    .filter((r) => {
      const day = r.starts_local.slice(0, 10)
      return r.status !== 'cancelled' && day >= range.from && day <= range.to
    })
    .map((r) => ({
      id: r.id,
      module: 'health',
      title: r.provider_name ? `${r.what} · ${r.provider_name}` : r.what,
      startsAt: r.starts_local,
      allDay: false,
      href: '/health',
      kind: 'appointment',
      done: r.status === 'done',
    }))
}

export type MedicationRow = {
  id: string
  name: string
  refill_on: string
  ended_on: string | null
}

export function refillItems(
  rows: MedicationRow[],
  range: { from: string; to: string },
): CalendarItem[] {
  return rows
    .filter(
      (r) =>
        (r.ended_on === null || r.ended_on >= r.refill_on) &&
        r.refill_on >= range.from &&
        r.refill_on <= range.to,
    )
    .map((r) => ({
      id: `${r.id}:${r.refill_on}`,
      module: 'health',
      title: `Refill ${r.name}`,
      startsAt: r.refill_on,
      allDay: true,
      href: '/health',
      kind: 'refill',
    }))
}

export async function calendarFor(range: { from: string; to: string }): Promise<CalendarItem[]> {
  const [{ rows: appointments }, { rows: medications }] = await Promise.all([
    db().query<AppointmentRow>(
      `select a.id, a.what, a.status, p.name as provider_name,
              to_char(a.starts_at at time zone ${TZ}, 'YYYY-MM-DD"T"HH24:MI') as starts_local
         from health.appointment a
         left join health.provider p on p.id = a.provider_id
        where (a.starts_at at time zone ${TZ})::date between $1 and $2`,
      [range.from, range.to],
    ),
    db().query<MedicationRow>(
      `select id, name, refill_on::text, ended_on::text
         from health.medication
        where refill_on between $1 and $2`,
      [range.from, range.to],
    ),
  ])

  return [...appointmentItems(appointments, range), ...refillItems(medications, range)]
}
