import { db } from '@/core/db'
import type { CalendarItem } from '@/core/module-contract'

// What Goals puts on the Calendar: a deadline. Archived goals never show.
// Whether a goal is met is left to Goals' own progress, which a check-in alone
// does not answer for a goal tracked from another module's metric.

export type GoalRow = {
  id: string
  title: string
  deadline: string
}

export function toCalendarItems(rows: GoalRow[], range: { from: string; to: string }): CalendarItem[] {
  return rows
    .filter((r) => r.deadline >= range.from && r.deadline <= range.to)
    .map((r) => ({
      id: r.id,
      module: 'goals',
      title: r.title,
      startsAt: r.deadline,
      allDay: true,
      href: '/goals',
      kind: 'goal',
    }))
}

export async function calendarFor(range: { from: string; to: string }): Promise<CalendarItem[]> {
  const { rows } = await db().query<GoalRow>(
    `select id, title, deadline::text
       from goals.goal
      where archived = false
        and deadline between $1 and $2`,
    [range.from, range.to],
  )
  return toCalendarItems(rows, range)
}
