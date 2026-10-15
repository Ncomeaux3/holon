import { minutesIn } from './clock'
import { db } from './db'
import { getModule } from './modules'
import { getReview, weekNumber, weekOf } from './reviews'
import { getSettings } from './settings'
import { ownerToday } from './today'
import { callTool } from './tools'

// The weekly review's schedule: one in-app reminder at the review day and
// time, and optionally one repeating task in Tasks. Both are rewritten from
// the settings on every save and every night, so a changed time never leaves
// the old one behind.

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The date of the next review: the review day this week or next, and next
 * week's when today is the day and its time has passed. Pure: the local
 * "HH:MM" becomes an instant in SQL, which knows daylight saving.
 */
export function nextReviewDate(todayIso: string, nowMinutes: number, day: number, time: string): string {
  const dow = new Date(`${todayIso}T12:00:00Z`).getUTCDay()
  const [h, m] = time.split(':').map(Number)
  let ahead = (day - dow + 7) % 7
  if (ahead === 0 && nowMinutes >= h * 60 + m) ahead = 7
  return addDays(todayIso, ahead)
}

/** "Sunday 18:00". */
export function reviewWhen(day: number, time: string): string {
  return `${DAYS[day]} ${time}`
}

/**
 * Rewrite the queued reminder. A reminder still in the future is deleted and
 * queued again from the settings; one already due stays until it is read or
 * sent. Skipped while the switch is off, and for a week already closed, in
 * which case the next week's review is the one queued.
 */
export async function ensureReviewReminder(): Promise<{ queued: string | null }> {
  const settings = await getSettings()
  await db().query(
    `delete from core.notifications
      where sent_at is null and due_at > now()
        and rule_id = (select id from core.notification_rules where module = 'system' and key = 'weekly_review')`,
  )
  if (!settings.review_reminder) return { queued: null }

  let date = nextReviewDate(
    await ownerToday(),
    minutesIn(new Date(), settings.timezone),
    settings.review_day,
    settings.review_time,
  )
  if ((await getReview(weekOf(date, settings.week_start)))?.closed_at) date = addDays(date, 7)

  const week = weekNumber(date, settings.week_start)
  await db().query(
    `insert into core.notifications (channel, title, body, due_at, urgency, href, rule_id)
     select 'inapp', 'Time for the weekly review', $1,
            ($2::date + $3::time) at time zone $4, 'normal', '/weekly-review', r.id
       from core.notification_rules r
      where r.module = 'system' and r.key = 'weekly_review'`,
    [`${reviewWhen(settings.review_day, settings.review_time)}, week ${week}`, date, settings.review_time, settings.timezone],
  )
  return { queued: date }
}

/**
 * Write, move or remove the repeating task to match the settings. Run on a
 * save of the switch or the day, not nightly: after a completion the next
 * instance is writeNext's, and moving it back would undo the close.
 * No Tasks module, nothing to do.
 */
export async function ensureReviewTask(): Promise<void> {
  if (!getModule('tasks')) return
  const settings = await getSettings()
  if (!settings.review_task) {
    await callTool('tasks', 'review_task', { action: 'off' }, { source: 'ui' })
    return
  }
  // Due today when today is the day; a closed week's task belongs to next week.
  let due = nextReviewDate(await ownerToday(), 0, settings.review_day, '23:59')
  if ((await getReview(weekOf(due, settings.week_start)))?.closed_at) due = addDays(due, 7)
  await callTool('tasks', 'review_task', { action: 'set', day: settings.review_day, due_on: due }, { source: 'ui' })
}

/**
 * Closing the review: every unsent reminder goes, the one already due
 * included (a closed week is reviewed), and next week's is queued. The open
 * task is completed, which writes next week's, but only when it is due by the
 * end of the closed week: ticked in Tasks first, the open one is already next
 * week's and stays.
 */
export async function reviewClosed(week: string): Promise<void> {
  await db().query(
    `delete from core.notifications
      where sent_at is null
        and rule_id = (select id from core.notification_rules where module = 'system' and key = 'weekly_review')`,
  )
  await ensureReviewReminder()
  if (!getModule('tasks') || !(await getSettings()).review_task) return
  const found = await callTool('tasks', 'review_task', { action: 'find' }, { source: 'ui' })
  const open = found.status === 'done' ? (found.result as { id: string | null; due_on: string | null }) : null
  if (open?.id && open.due_on && open.due_on <= addDays(week, 6)) {
    await callTool('tasks', 'complete', { id: open.id }, { source: 'ui' })
  }
}
