'use client'

import { useState } from 'react'
import { Row, RowList } from '@/components/pos'
import { MonthGrid, isoDay, type GridItem } from '@/components/pos/MonthGrid'
import { projectDue } from '../repeat'
import type { Task } from '../shape'

// Tasks' month view: the shared grid, with a task's priority and review state
// as the item's tone and a tap opening its drawer. Selecting a day lists its
// tasks under the grid. A repeating task's later dates are drawn muted from
// its rule; no rows are written for them, and opening one opens the task.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "Wednesday, 23 September", as the Calendar module heads its day. */
function longDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

type DayTask = { task: Task; projected: boolean }

export function Calendar({
  tasks,
  today,
  onOpen,
}: {
  tasks: Task[]
  today: Date
  onOpen: (task: Task) => void
}) {
  const [offset, setOffset] = useState(0)
  const todayIso = isoDay(today.getFullYear(), today.getMonth(), today.getDate())
  const [selected, setSelected] = useState(todayIso)

  /** YYYY-MM-DD of a task's due day, from its offset in days. */
  const dueIso = (t: Task) => {
    if (t.dueInDays === null) return null
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + t.dueInDays)
    return isoDay(d.getFullYear(), d.getMonth(), d.getDate())
  }

  const shown = new Date(today.getFullYear(), today.getMonth() + offset, 1)
  const monthKey = isoDay(shown.getFullYear(), shown.getMonth(), 1).slice(0, 7)
  const monthEnd = isoDay(
    shown.getFullYear(),
    shown.getMonth(),
    new Date(shown.getFullYear(), shown.getMonth() + 1, 0).getDate(),
  )
  // Through the later of the shown month and the selected day, so the list
  // under the grid agrees with it whichever was moved last.
  const until = selected > monthEnd ? selected : monthEnd

  const byDay = new Map<string, DayTask[]>()
  const add = (iso: string, entry: DayTask) => byDay.set(iso, [...(byDay.get(iso) ?? []), entry])
  for (const t of tasks) {
    const due = dueIso(t)
    if (!due) continue
    add(due, { task: t, projected: false })
    if (t.repeat) {
      // Not on or before today: completing skips those dates, so an overdue
      // repeat's past days would never come.
      for (const iso of projectDue(t.repeat, due, until)) {
        if (iso > todayIso) add(iso, { task: t, projected: true })
      }
    }
  }
  const on = (iso: string) =>
    (byDay.get(iso) ?? []).sort((a, b) => (a.task.dueAt ?? '99:99').localeCompare(b.task.dueAt ?? '99:99'))

  const inMonth = tasks.filter((t) => dueIso(t)?.startsWith(monthKey))
  const dayTasks = on(selected)

  return (
    <div className="space-y-5">
      <MonthGrid
        today={today}
        offset={offset}
        onOffset={(next) => {
          setOffset(next)
          // Keep the selection in the month on screen, as the Calendar module
          // does: today on its own month, the first otherwise.
          const d = new Date(today.getFullYear(), today.getMonth() + next, 1)
          setSelected(next === 0 ? todayIso : isoDay(d.getFullYear(), d.getMonth(), 1))
        }}
        selected={selected}
        onSelect={setSelected}
        meta={`${inMonth.length} open · ${inMonth.filter((t) => t.remindMinutes !== null).length} with reminders`}
        itemsOn={(iso) =>
          on(iso).map(
            ({ task: t, projected }): GridItem => ({
              id: projected ? `${t.id}:${iso}` : t.id,
              title: t.title,
              time: t.dueAt,
              tone: projected
                ? 'muted'
                : t.priority === 'P1'
                  ? 'bad'
                  : t.status === 'review'
                    ? 'warn'
                    : 'default',
              onOpen: () => onOpen(t),
            }),
          )
        }
      />

      <section aria-labelledby="tasks-day" data-day={selected} className="space-y-3">
        <h2 id="tasks-day" className="text-title-3 text-label">
          {longDay(selected)}
        </h2>
        {dayTasks.length === 0 ? (
          <p className="text-footnote text-secondary-label">Nothing due on this day.</p>
        ) : (
          <RowList>
            {dayTasks.map(({ task: t, projected }) => (
              <Row
                key={projected ? `${t.id}:${selected}` : t.id}
                title={t.title}
                meta={
                  [t.projectName, projected && 'Expected, from its repeat']
                    .filter(Boolean)
                    .join(' · ') || undefined
                }
                date={t.dueAt ?? 'All day'}
                muted={projected}
                onClick={() => onOpen(t)}
              />
            ))}
          </RowList>
        )}
      </section>
    </div>
  )
}
