// The quick add line. No imports: the add form is a client component, and
// anything here that reached core/db.ts would drag pg into the browser bundle.
//
// Deterministic on purpose. This is a parser, not a classifier, so no model
// call and no guessing: a token it does not recognise is left in the title
// where the reader can see it, rather than dropped.

export type Priority = 'P1' | 'P2' | 'P3'

export type QuickAdd = {
  title: string
  priority: Priority
  /** Days from today. Null means no date, which is a real state, not a zero. */
  dueInDays: number | null
  project: string | null
  estimateMinutes: number | null
  /** What it understood, shown back before the task is saved. */
  parsed: { field: string; value: string }[]
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const NAMED: Record<string, number> = {
  today: 0,
  tomorrow: 1,
  tmrw: 1,
  week: 4,
  later: 14,
}

/**
 * "Today", "Tomorrow", "Thu", "Sep 25". What the chip in the box says.
 *
 * `now` is a parameter rather than a call to new Date() inside, so the weekday
 * name is the one the caller is reasoning about. A label that reads the clock
 * itself is untestable and wrong either side of midnight.
 */
export function dueLabel(days: number | null, now: Date = new Date()): string {
  if (days === null) return 'No date'
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 7) return DAYS[(now.getDay() + days) % 7].replace(/^./, (c) => c.toUpperCase())
  const d = new Date(now)
  d.setDate(d.getDate() + days)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export function estimateLabel(minutes: number | null): string {
  if (minutes === null) return ''
  if (minutes < 60) return `${minutes}m`
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
}

export function parseQuickAdd(
  input: string,
  options: { projects: string[]; now?: Date },
): QuickAdd {
  const now = options.now ?? new Date()

  let title = input
  let priority: Priority = 'P2'
  let dueInDays: number | null = null
  let project: string | null = null
  let estimateMinutes: number | null = null

  title = title.replace(/!p([123])\b/i, (whole, digit: string) => {
    priority = `P${digit}` as Priority
    return ''
  })

  // An unrecognised project stays put. Removing it would lose a word the owner
  // typed on the strength of a guess about what they meant.
  title = title.replace(/#(\w+)/, (whole, name: string) => {
    const match = options.projects.find((p) => p.toLowerCase() === name.toLowerCase())
    if (!match) return whole
    project = match
    return ''
  })

  title = title.replace(/@(\w+)/, (whole, word: string) => {
    const day = word.toLowerCase()

    if (day in NAMED) {
      dueInDays = NAMED[day]
      return ''
    }

    const index = DAYS.findIndex((d) => day.startsWith(d) && day.length >= 3)
    if (index < 0) return whole

    // Naming the current weekday means next week. Zero would make "@tue" on a
    // Tuesday a silent synonym for @today, and there is already a word for that.
    const ahead = (index - now.getDay() + 7) % 7
    dueInDays = ahead === 0 ? 7 : ahead
    return ''
  })

  // Anchored to a unit, so "ch. 5" and "Deadlift 385" keep their numbers. The
  // unit has to end the token: "385" alone never matches.
  title = title.replace(/\b(\d+(?:\.\d+)?)\s?(m|min|mins|h|hr|hrs)\b/i, (whole, n: string, unit: string) => {
    const value = Number(n)
    estimateMinutes = unit.toLowerCase().startsWith('h') ? Math.round(value * 60) : Math.round(value)
    return ''
  })

  const parsed: QuickAdd['parsed'] = []
  if (dueInDays !== null) parsed.push({ field: 'Due', value: dueLabel(dueInDays, now) })
  if (priority !== 'P2') parsed.push({ field: 'Priority', value: priority })
  if (project) parsed.push({ field: 'Project', value: project })
  if (estimateMinutes !== null) {
    parsed.push({ field: 'Estimate', value: estimateLabel(estimateMinutes) })
  }

  return {
    title: title.replace(/\s+/g, ' ').trim(),
    priority,
    dueInDays,
    project,
    estimateMinutes,
    parsed,
  }
}
