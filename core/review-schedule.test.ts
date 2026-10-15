import { afterEach, describe, expect, it } from 'vitest'
import { clockIn } from './clock'
import { db } from './db'
import { ensureReviewReminder, nextReviewDate, reviewClosed } from './review-schedule'
import { callTool } from './tools'
import { weekOf } from './reviews'
import { setSetting } from './settings'

describe('nextReviewDate', () => {
  // 2026-10-14 is a Wednesday.
  it('finds the review day later this week, or next week', () => {
    expect(nextReviewDate('2026-10-14', 600, 0, '18:00')).toBe('2026-10-18')
    expect(nextReviewDate('2026-10-14', 600, 5, '16:00')).toBe('2026-10-16')
    expect(nextReviewDate('2026-10-14', 600, 1, '08:00')).toBe('2026-10-19')
  })

  it('is today until the time passes, then a week on', () => {
    expect(nextReviewDate('2026-10-14', 17 * 60, 3, '18:00')).toBe('2026-10-14')
    expect(nextReviewDate('2026-10-14', 18 * 60, 3, '18:00')).toBe('2026-10-21')
  })

  it('crosses a year boundary', () => {
    // 2026-12-31 is a Thursday; the next Sunday is in 2027.
    expect(nextReviewDate('2026-12-31', 0, 0, '18:00')).toBe('2027-01-03')
  })
})

const queued = async () =>
  (
    await db().query<{ due_at: Date; body: string; href: string }>(
      `select n.due_at, n.body, n.href from core.notifications n
         join core.notification_rules r on r.id = n.rule_id
        where r.module = 'system' and r.key = 'weekly_review' and n.sent_at is null`,
    )
  ).rows

afterEach(async () => {
  await db().query(`delete from core.settings where key like 'review_%' or key in ('week_start', 'timezone')`)
  await db().query(
    `delete from core.notifications where rule_id = (select id from core.notification_rules where key = 'weekly_review')`,
  )
  await db().query(`delete from core.reviews`)
  await db().query(`delete from tasks.task where title = 'Weekly review'`)
  // Registered and parked by the classifier; left behind they are rows for
  // the skills reclassify test to find.
  await db().query(`delete from core.entities where module = 'tasks' and title = 'Weekly review'`)
})

describe('ensureReviewReminder', () => {
  it('queues one alert at the review time in the owner\'s zone, and moves it on a change', async () => {
    await setSetting('timezone', 'America/Chicago')
    await setSetting('review_reminder', true)
    await setSetting('review_day', 0)
    await setSetting('review_time', '18:00')

    const { queued: date } = await ensureReviewReminder()
    let rows = await queued()
    expect(rows).toHaveLength(1)
    // The instant reads 18:00 on a Sunday in Chicago, whichever side of a
    // daylight saving change the date falls on.
    expect(clockIn(rows[0].due_at, 'America/Chicago')).toBe('18:00')
    expect(new Date(`${date}T12:00:00Z`).getUTCDay()).toBe(0)
    expect(rows[0].href).toBe('/weekly-review')
    expect(rows[0].body).toMatch(/^Sunday 18:00, week \d+$/)

    await setSetting('review_time', '09:30')
    await ensureReviewReminder()
    rows = await queued()
    expect(rows).toHaveLength(1)
    expect(clockIn(rows[0].due_at, 'America/Chicago')).toBe('09:30')
  })

  it('skips a week already closed, and queues nothing when off', async () => {
    await setSetting('review_reminder', true)
    const first = (await ensureReviewReminder()).queued!
    await db().query(`insert into core.reviews (week_of, closed_at) values ($1, now())`, [weekOf(first)])

    const second = (await ensureReviewReminder()).queued!
    expect(Date.parse(second) - Date.parse(first)).toBe(7 * 86_400_000)
    expect(await queued()).toHaveLength(1)

    await setSetting('review_reminder', false)
    await ensureReviewReminder()
    expect(await queued()).toHaveLength(0)
  })
})

describe('reviewClosed', () => {
  it('drops a reminder already due, so a closed week is not reminded', async () => {
    await setSetting('review_reminder', true)
    await db().query(
      `insert into core.notifications (channel, title, body, due_at, rule_id)
       select 'inapp', 'Time for the weekly review', 'due an hour ago', now() - interval '1 hour', id
         from core.notification_rules where module = 'system' and key = 'weekly_review'`,
    )
    const week = weekOf(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()))
    await db().query(`insert into core.reviews (week_of, closed_at) values ($1, now())`, [week])

    await reviewClosed(week)
    const rows = await queued()
    expect(rows).toHaveLength(1)
    expect(rows[0].due_at.getTime()).toBeGreaterThan(Date.now())
  })

  it('completes the task due in the closed week, and not next week\'s', async () => {
    await setSetting('review_task', true)
    const ui = { source: 'ui' as const }
    const status = async () =>
      (await db().query<{ due_on: string; status: string }>(
        `select due_on::text, status from tasks.task where title = 'Weekly review' order by due_on`,
      )).rows

    await callTool('tasks', 'review_task', { action: 'set', day: 0, due_on: '2026-10-18' }, ui)
    await reviewClosed('2026-10-12')
    expect(await status()).toEqual([
      { due_on: '2026-10-18', status: 'done' },
      expect.objectContaining({ status: 'open' }),
    ])

    // Closing the same week again finds next week's open task and leaves it.
    const before = await status()
    await reviewClosed('2026-10-12')
    expect(await status()).toEqual(before)
  })
})
