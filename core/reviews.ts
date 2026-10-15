import { startOfWeek, type WeekStart } from './clock'
import { db } from './db'
import type { ReviewAnswers } from './reviews-shape'

// The Weekly Review's record. One row per week, resumable, written last.

export type Review = {
  id: string
  week_of: string
  answers: ReviewAnswers
  priorities: string[]
  note_ref: string | null
  closed_at: Date | null
}

/** The day that starts the week a date falls in, as YYYY-MM-DD. */
export function weekOf(iso: string, weekStart: WeekStart = 'monday'): string {
  return startOfWeek(iso, weekStart)
}

/**
 * The ISO week number, which is what the band calls the week.
 *
 * ISO 8601: week one is the one holding the first Thursday of the year, so the
 * count is taken from the Thursday of the week in question rather than from
 * its first day. A Sunday week is numbered by the Monday to Sunday week its
 * Thursday falls in. The last days of December can belong to week one of the
 * year after, and this returns that.
 */
export function weekNumber(iso: string, weekStart: WeekStart = 'monday'): number {
  const thursday = new Date(`${weekOf(iso, weekStart)}T12:00:00Z`)
  thursday.setUTCDate(thursday.getUTCDate() + (weekStart === 'sunday' ? 4 : 3))

  const firstThursday = new Date(`${thursday.getUTCFullYear()}-01-04T12:00:00Z`)
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3)

  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86_400_000))
}

export async function getReview(week: string): Promise<Review | null> {
  const { rows } = await db().query<Review>(
    `select id, week_of::text, answers, priorities, note_ref, closed_at
       from core.reviews where week_of = $1`,
    [week],
  )
  return rows[0] ?? null
}

export async function listReviews(limit = 8): Promise<Review[]> {
  const { rows } = await db().query<Review>(
    `select id, week_of::text, answers, priorities, note_ref, closed_at
       from core.reviews order by week_of desc limit $1`,
    [limit],
  )
  return rows
}

/**
 * Save progress without closing. The wizard is six steps and the answers are
 * stored as it goes, so a review interrupted at step four is resumable rather
 * than lost.
 */
export async function saveAnswers(week: string, answers: ReviewAnswers): Promise<void> {
  await db().query(
    `insert into core.reviews (week_of, answers) values ($1, $2::jsonb)
     on conflict (week_of) do update set answers = excluded.answers`,
    [week, JSON.stringify(answers)],
  )
}

export async function closeReview(args: {
  week: string
  answers: ReviewAnswers
  priorities: string[]
  noteRef: string | null
}): Promise<void> {
  await db().query(
    `insert into core.reviews (week_of, answers, priorities, note_ref, closed_at)
     values ($1, $2::jsonb, $3, $4, now())
     on conflict (week_of) do update
       set answers = excluded.answers,
           priorities = excluded.priorities,
           note_ref = excluded.note_ref,
           closed_at = now()`,
    [args.week, JSON.stringify(args.answers), args.priorities, args.noteRef],
  )
}

/**
 * Which module takes the week note.
 *
 * Second Brain owns notes. Resolved through the registry rather than
 * hardcoded, so the close degrades to writing nothing when it is not
 * installed, which is what lets a fork delete it.
 */
export async function noteWriter(): Promise<string | null> {
  const { getModule } = await import('./modules')
  return getModule('brain')?.tools.write ? 'brain' : null
}
