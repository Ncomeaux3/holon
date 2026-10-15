'use client'

import { Check } from 'lucide-react'
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { CHEVRON, RowList, STRETCH, STRETCH_WRAP, useToast } from '@/components/pos'
import { HIT } from '@/components/pos/button-classes'
import { cn } from '@/lib/utils'
import type { TasksDigest } from '../jobs/nightly-digest'
import { hoursLabel } from '../shape'
import { completeTask } from './actions'

// Today's work on the Today page: the next tasks from the digest as rows, a
// check circle in front of each, the project under the title and one mark on
// the right. What is due, not how many are due; the count is the section's
// heading.
//
// The circles tick. Completing here is the same write the board makes, so a
// task ticked on Today earns the same XP.

export function TasksTile({ payload }: { payload: Record<string, unknown> }) {
  const d = payload as Partial<TasksDigest>
  const upcoming = d.upcoming ?? []
  const due = d.dueToday ?? 0
  const overdue = d.overdue ?? 0
  // The date the digest dated its rows against: the nightly's day, or this
  // minute's, since every write recomputes it. A digest from before the
  // field existed listed nothing overdue, so its first row is the day.
  const today = d.today ?? upcoming[0]?.dueOn ?? ''

  const [ticked, setTicked] = useState<string[]>([])
  const [pending, start] = useTransition()
  const toast = useToast()

  if (upcoming.length === 0 && due === 0 && overdue === 0) {
    return <p className="px-1 text-footnote text-secondary-label">Nothing due today.</p>
  }

  const tick = (id: string) => {
    setTicked((t) => [...t, id])
    start(async () => {
      const result = await completeTask(id)
      if (!result.ok) {
        setTicked((t) => t.filter((x) => x !== id))
        toast(result.error)
      }
    })
  }

  return (
    <RowList>
      {upcoming.map((t) => {
        const on = t.status === 'done' || ticked.includes(t.id)
        const tag = tagFor(t, today)
        return (
          // The title is a link to the task's drawer, stretched over the row;
          // the check circle sits above it (v1.2 phase 3d).
          <div
            key={t.id}
            className={cn(STRETCH_WRAP, 'flex items-start gap-3 px-4 py-2.5 before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-separator first:before:hidden')}
          >
            <button
              type="button"
              disabled={on || pending}
              onClick={() => tick(t.id)}
              aria-label={`Complete ${t.title}`}
              className={cn(
                HIT,
                // 20px ring, a 44px hit area through HIT.
                'relative z-10 mt-px grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-150',
                on ? 'border-accent bg-accent text-accent-fg' : 'border-gray hover:border-accent',
              )}
            >
              {on && <Check size={12} strokeWidth={3} aria-hidden />}
            </button>
            <Link href={`/tasks?task=${t.id}`} className={cn(STRETCH, 'min-w-0 flex-1')}>
              <span className={cn('block truncate text-body', on ? 'text-secondary-label line-through' : 'text-label')}>
                {t.title}
              </span>
              <span className="mt-0.5 block truncate text-subheadline text-secondary-label">
                {t.project ?? 'No project'}
              </span>
            </Link>
            <span
              className={cn(
                'num shrink-0 pt-0.5 text-subheadline',
                tag.tone === 'action' && 'font-medium text-accent',
                tag.tone === 'bad' && 'font-medium text-red-text',
                !tag.tone && 'text-secondary-label',
              )}
            >
              {tag.text}
            </span>
            <span aria-hidden="true" className={cn(CHEVRON, 'shrink-0')}>
              &rsaquo;
            </span>
          </div>
        )
      })}
    </RowList>
  )
}

/**
 * The one mark on the right of a row: a finished task says done, an agent's
 * task says review, an overdue one says so, a task due later says when, a
 * task with an estimate says how long, and the rest say the priority.
 */
function tagFor(
  t: { priority: string; dueOn: string | null; estimateMinutes?: number | null; status?: string },
  today: string,
): { text: string; tone?: 'action' | 'bad' } {
  if (t.status === 'done' || t.dueOn === null) return { text: 'done' }
  if (t.status === 'review') return { text: 'Review', tone: 'action' }
  if (t.dueOn < today) return { text: 'Overdue', tone: 'bad' }
  if (t.dueOn > today) {
    const d = new Date(`${t.dueOn}T12:00:00`)
    return { text: `${MONTHS[d.getMonth()]} ${d.getDate()}` }
  }
  if (t.estimateMinutes) return { text: hoursLabel(t.estimateMinutes) }
  return { text: t.priority }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
