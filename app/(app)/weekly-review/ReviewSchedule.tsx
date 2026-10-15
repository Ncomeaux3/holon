'use client'

import { useState, useTransition } from 'react'
import { fieldClass, Switch, timeFieldClass, useToast } from '@/components/pos'
import { cn } from '@/lib/utils'
import { updateSchedule, type Schedule } from './actions'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * When the review happens, collapsed to one line above the wizard. Each control
 * saves on its own, and the server rewrites the reminder and the task to match.
 */
export function ReviewSchedule({ initial, hasTasks }: { initial: Schedule; hasTasks: boolean }) {
  const [s, setS] = useState(initial)
  const [pending, start] = useTransition()
  const toast = useToast()

  const save = <K extends keyof Schedule>(key: K, value: Schedule[K]) => {
    const before = s
    setS({ ...s, [key]: value })
    start(async () => {
      const result = await updateSchedule(key, value)
      if (!result.ok) {
        setS(before)
        toast(result.error)
      }
    })
  }

  const summary = [
    `${DAYS[s.review_day]} ${s.review_time}`,
    s.review_reminder ? 'reminder on' : 'no reminder',
    hasTasks && s.review_task ? 'task on' : null,
    `weeks start ${s.week_start === 'sunday' ? 'Sun' : 'Mon'}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <details className="group mb-8 rounded-card bg-grouped-2">
      <summary className="flex min-h-(--target) cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-footnote">
        <span className="text-pretty">
          <span className="text-label">Schedule</span>{' '}
          <span className="text-secondary-label" data-testid="review-schedule-summary">{summary}</span>
        </span>
        <span aria-hidden className="text-secondary-label transition-transform group-open:rotate-90">›</span>
      </summary>

      <div className="space-y-4 border-t border-separator px-4 pb-4 pt-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-footnote text-label" htmlFor="review-day">Review on</label>
          <select
            id="review-day"
            value={s.review_day}
            disabled={pending}
            onChange={(e) => save('review_day', Number(e.target.value))}
            className={cn(fieldClass, 'w-auto')}
          >
            {DAYS.map((d, i) => (
              <option key={d} value={i}>{d}</option>
            ))}
          </select>
          <span className="flex items-center gap-3">
            <span className="text-footnote text-secondary-label">at</span>
            <input
              type="time"
              aria-label="Review time"
              defaultValue={s.review_time}
              disabled={pending}
              onBlur={(e) => e.target.value && e.target.value !== s.review_time && save('review_time', e.target.value)}
              className={timeFieldClass}
            />
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-footnote text-label" htmlFor="week-start">Weeks start on</label>
          <select
            id="week-start"
            value={s.week_start}
            disabled={pending}
            onChange={(e) => save('week_start', e.target.value as Schedule['week_start'])}
            className={cn(fieldClass, 'w-auto')}
          >
            <option value="monday">Monday</option>
            <option value="sunday">Sunday</option>
          </select>
          <span className="text-footnote text-secondary-label">For Tasks, Meals, the Calendar strip, Fitness and this review.</span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-footnote text-label">
            Remind me
            <span className="block text-secondary-label">An alert in Notifications at the review time, skipped once the week is closed.</span>
          </span>
          <Switch label="Remind me" checked={s.review_reminder} disabled={pending} onChange={(v) => save('review_reminder', v)} />
        </div>

        {hasTasks && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-footnote text-label">
              Add as a recurring task
              <span className="block text-secondary-label">One &ldquo;Weekly review&rdquo; task on the review day. Closing the review completes it.</span>
            </span>
            <Switch label="Add as a recurring task" checked={s.review_task} disabled={pending} onChange={(v) => save('review_task', v)} />
          </div>
        )}
      </div>
    </details>
  )
}
