// A repeating task's rule and the date arithmetic behind it. Pure and import
// free: the board projects repeats in the browser and the complete tool writes
// the next instance on the server, from the same function. Dates are
// YYYY-MM-DD strings, read as UTC so no timezone moves a day; the owner's
// today comes in from the caller.

export type Repeat = {
  every: 'day' | 'week' | 'month' | 'year'
  /** Weekdays 0 (Sun) to 6 for a weekly rule; a day of month 1 to 31, or -1 for the last, for a monthly one. */
  on?: number[]
  interval?: number
}

const DAY = 86_400_000
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const addDays = (iso: string, days: number) => toIso(toMs(iso) + days * DAY)

/** The date in `month` months from `iso`'s month, on `day` (-1 is the last), clamped to that month's end. */
function onDay(iso: string, months: number, day: number): string {
  const [y, m] = iso.split('-').map(Number)
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate()
  return toIso(Date.UTC(y, m - 1 + months, day === -1 ? last : Math.min(day, last)))
}

/** The first date of the rule strictly after `from`. */
export function nextDue(repeat: Repeat, from: string): string {
  const interval = Math.max(1, repeat.interval ?? 1)
  const on = repeat.on ?? []

  if (repeat.every === 'day') return addDays(from, interval)

  if (repeat.every === 'week') {
    if (on.length === 0) return addDays(from, 7 * interval)
    const weekday = new Date(toMs(from)).getUTCDay()
    const later = on.filter((d) => d > weekday).sort((a, b) => a - b)[0]
    if (later !== undefined) return addDays(from, later - weekday)
    // Wrap to the first named day of the week `interval` weeks on.
    return addDays(from, 7 * interval - weekday + Math.min(...on))
  }

  if (repeat.every === 'month') {
    // Anchored to the named day, so the 31st clamped to 28 February is still
    // the 31st in March rather than the 28th from then on.
    const day = on[0] ?? Number(from.slice(8, 10))
    const same = onDay(from, 0, day)
    return same > from ? same : onDay(from, interval, day)
  }

  // ponytail: a 29 February yearly task drifts to the 28th after its first
  // step; an explicit month and day in `on` fixes it if one ever exists.
  return onDay(from, 12 * interval, Number(from.slice(8, 10)))
}

/**
 * The due date of the instance after one completed today: the first date past
 * both the old due date and today, so a task closed two months late comes back
 * once, ahead, rather than already overdue. No due date counts from today.
 */
export function nextAfter(repeat: Repeat, due: string | null, today: string): string {
  let next = nextDue(repeat, due ?? today)
  while (next <= today) next = nextDue(repeat, next)
  return next
}

/** The dates after `first` through `to`, inclusive: the projected instances a calendar draws. */
export function projectDue(repeat: Repeat, first: string, to: string): string[] {
  const dates: string[] = []
  for (let d = nextDue(repeat, first); d <= to; d = nextDue(repeat, d)) dates.push(d)
  return dates
}

/**
 * The same rule, field by field. Not JSON.stringify: a rule read back from a
 * jsonb column has its keys reordered ({"on": [3], "every": "week"}), so a
 * string comparison never matches a saved weekly or monthly rule.
 */
export function sameRule(a: Repeat, b: Repeat): boolean {
  const days = (r: Repeat) => [...(r.on ?? [])].sort((x, y) => x - y).join()
  return a.every === b.every && (a.interval ?? 1) === (b.interval ?? 1) && days(a) === days(b)
}

const ordinal = (n: number) => {
  const tens = n % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')
  return `${n}${suffix}`
}

/** "Monthly on the 23rd", "Weekly on Mon, Fri", "Every 2 months on the 1st". */
export function repeatLabel(repeat: Repeat): string {
  const interval = repeat.interval ?? 1
  const on = repeat.on ?? []
  const unit = { day: 'day', week: 'week', month: 'month', year: 'year' }[repeat.every]
  const head =
    interval > 1
      ? `Every ${interval} ${unit}s`
      : { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' }[repeat.every]

  if (repeat.every === 'week' && on.length > 0) {
    return `${head} on ${[...on].sort((a, b) => a - b).map((d) => WEEKDAYS[d]).join(', ')}`
  }
  if (repeat.every === 'month' && on.length > 0) {
    return `${head} on the ${on[0] === -1 ? 'last day' : ordinal(on[0])}`
  }
  return head
}
