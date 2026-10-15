import { db } from '@/core/db'
import { ownerToday } from '@/core/today'
import type { CalendarItem } from '@/core/module-contract'
import { projectDue, type Repeat } from './repeat'

// What Tasks puts on the Calendar. Open, review and done tasks with a due
// date; a done task shows muted rather than dropping off the day it closed.
// An open repeating task also puts its later dates on, projected from its
// rule; no rows are written for them.

export type TaskRow = {
  id: string
  title: string
  due_on: string
  /** 'HH:MM', or null for a task with no time of day. */
  due_at: string | null
  status: string
  repeat: Repeat | null
}

export function toCalendarItems(
  rows: TaskRow[],
  range: { from: string; to: string },
  today: string,
): CalendarItem[] {
  const item = (r: TaskRow, on: string) => ({
    module: 'tasks',
    title: r.title,
    startsAt: r.due_at ? `${on}T${r.due_at}` : on,
    allDay: r.due_at === null,
    href: `/tasks?task=${r.id}`,
    kind: 'task',
  })
  return rows.flatMap((r) => [
    ...(r.due_on >= range.from && r.due_on <= range.to
      ? [{ ...item(r, r.due_on), id: r.id, done: r.status === 'done' }]
      : []),
    // A done instance already wrote its successor, which projects instead.
    // Nothing on or before today: completing skips those dates (nextAfter),
    // so an overdue repeat's past days would never come.
    ...(r.repeat && r.status !== 'done'
      ? projectDue(r.repeat, r.due_on, range.to)
          .filter((on) => on >= range.from && on > today)
          .map((on) => ({ ...item(r, on), id: `${r.id}:${on}`, projected: true }))
      : []),
  ])
}

export async function calendarFor(range: { from: string; to: string }): Promise<CalendarItem[]> {
  const { rows } = await db().query<TaskRow>(
    `select id, title, due_on::text, to_char(due_at, 'HH24:MI') as due_at, status, repeat
       from tasks.task
      where status in ('open', 'review', 'done')
        and (due_on between $1 and $2
             -- An open repeat due before the range still lands in it.
             or (repeat is not null and status <> 'done' and due_on < $1))`,
    [range.from, range.to],
  )
  return toCalendarItems(rows, range, await ownerToday())
}
