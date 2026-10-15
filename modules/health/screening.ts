// When a screening is due, and what a medication streak comes to. No imports:
// the Health screen is a client component and anything reaching core/db.ts
// drags pg into the browser bundle.
//
// Nothing here judges a number. SPEC's rule for Insurance applies just as much
// here: no gap analysis, no adequacy scoring, no model opinion about whether a
// reading is good. This module tracks what was done and when, and says nothing
// about what it means.

export type ScreeningStatus = 'due' | 'overdue' | 'soon' | 'ok' | 'snoozed' | 'never'

export type Screening = {
  intervalMonths: number
  lastDoneOn: string | null
  snoozeUntil: string | null
}

/** Inside this many days of the due date, a screening is worth mentioning. */
const SOON_DAYS = 60

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000

/** The date a screening is next due, or null when it has never been done. */
export function dueOn(screening: Screening): string | null {
  if (!screening.lastDoneOn) return null
  const d = new Date(`${screening.lastDoneOn}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + screening.intervalMonths)
  return d.toISOString().slice(0, 10)
}

/**
 * Where a screening stands.
 *
 * `never` is its own state rather than being folded into `overdue`. A screening
 * you have never had is a different conversation from one you are late for, and
 * showing it as months overdue when there is no baseline would be inventing a
 * history that does not exist.
 */
export function screeningStatus(screening: Screening, todayIso: string): ScreeningStatus {
  const today = day(todayIso)

  if (screening.snoozeUntil && day(screening.snoozeUntil) > today) return 'snoozed'
  if (!screening.lastDoneOn) return 'never'

  const due = dueOn(screening)
  if (!due) return 'never'

  const days = day(due) - today
  if (days < 0) return 'overdue'
  if (days === 0) return 'due'
  return days <= SOON_DAYS ? 'soon' : 'ok'
}

/** "3 months overdue", "due in 5 weeks", "never had one". */
export function screeningLabel(screening: Screening, todayIso: string): string {
  const status = screeningStatus(screening, todayIso)
  if (status === 'never') return 'never had one'
  if (status === 'snoozed') return `snoozed until ${screening.snoozeUntil}`

  const due = dueOn(screening)!
  const days = day(due) - day(todayIso)

  if (days === 0) return 'due today'
  if (days < 0) {
    const late = Math.abs(days)
    return late < 60 ? `${late} days overdue` : `${Math.round(late / 30)} months overdue`
  }
  if (days <= 14) return `due in ${days} days`
  if (days <= 90) return `due in ${Math.round(days / 7)} weeks`
  return `due in ${Math.round(days / 30)} months`
}

/**
 * How many days in a row a medication has been marked, counting back from
 * today.
 *
 * Today not being marked yet does not break a streak: it is not the end of the
 * day. Yesterday missing does. Anything else would either punish you at 9am or
 * never notice a miss at all.
 */
export function streak(takenOn: string[], todayIso: string): number {
  const marked = new Set(takenOn)
  const today = day(todayIso)

  let count = 0
  // Start at today if it is marked, otherwise at yesterday.
  let cursor = marked.has(todayIso) ? today : today - 1

  while (marked.has(new Date(cursor * 86_400_000).toISOString().slice(0, 10))) {
    count++
    cursor--
  }

  return count
}
