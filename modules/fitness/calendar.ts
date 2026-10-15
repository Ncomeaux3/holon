import { db } from '@/core/db'
import type { CalendarItem } from '@/core/module-contract'

// What Fitness puts on the Calendar: a workout, timed and already done.

const TZ = `coalesce((select value #>> '{}' from core.settings where key = 'timezone'), 'UTC')`

export type WorkoutRow = {
  id: string
  name: string
  /** YYYY-MM-DDTHH:MM in the owner's zone. */
  starts_local: string
}

export function toCalendarItems(
  rows: WorkoutRow[],
  range: { from: string; to: string },
): CalendarItem[] {
  return rows
    .filter((r) => {
      const day = r.starts_local.slice(0, 10)
      return day >= range.from && day <= range.to
    })
    .map((r) => ({
      id: r.id,
      module: 'fitness',
      title: r.name,
      startsAt: r.starts_local,
      allDay: false,
      href: '/fitness',
      kind: 'workout',
      done: true,
    }))
}

export async function calendarFor(range: { from: string; to: string }): Promise<CalendarItem[]> {
  const { rows } = await db().query<WorkoutRow>(
    `select id, name,
            to_char(started_at at time zone ${TZ}, 'YYYY-MM-DD"T"HH24:MI') as starts_local
       from fitness.workout
      where (started_at at time zone ${TZ})::date between $1 and $2`,
    [range.from, range.to],
  )
  return toCalendarItems(rows, range)
}
