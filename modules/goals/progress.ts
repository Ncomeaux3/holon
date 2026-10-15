// How far along a goal is, whether it is going to make it, and when it would
// land at the current pace. No imports: the Goals screen is a client component
// and anything reaching core/db.ts drags pg into the browser bundle.
//
// Every number here is arithmetic on the check-in history. Nothing is a model
// call and nothing is invented: a goal with two data points gets a projection
// built from two data points, and the screen says so.

export type GoalKind = 'number' | 'count' | 'streak' | 'milestone'

export type Status = 'done' | 'on_track' | 'at_risk' | 'stalled'

export const STATUS_LABELS: Record<Status, string> = {
  done: 'Done',
  on_track: 'On track',
  at_risk: 'At risk',
  stalled: 'Stalled',
}

/** One check-in: how many days ago, and what the value was. */
export type Point = { daysAgo: number; value: number; manual?: boolean }

export type Goal = {
  kind: GoalKind
  startValue: number
  targetValue: number
  /** Days from today. Negative is overdue. */
  deadlineInDays: number
  /** Days ago the goal was created, used for the expected pace line. */
  ageInDays: number
  /** Newest last. An empty history means nothing has been recorded. */
  history: Point[]
}

export type Progress = {
  current: number
  /** 0 to 100, clamped. A goal cannot be 140 percent done. */
  percent: number
  /** Where a straight line from start to deadline would have you by now. */
  expectedPercent: number
  daysLeft: number
  status: Status
  /** Units per day over the last 30 days, and over the whole history. */
  rate30: number
  rateAll: number
  /** Units per day needed from here to hit the target by the deadline. */
  neededRate: number
  /**
   * Days until the target at each rate, or null for "never at this pace".
   * Two models rather than one, because they disagree exactly when the answer
   * matters: a goal that has stalled recently still looks fine on its lifetime
   * average.
   */
  projected30: number | null
  projectedAll: number | null
  /** How long the value has been unchanged. */
  stalledDays: number
}

/** Days over which a fresh rate is measured, and past which a goal is stalled. */
const WINDOW = 30

/** Below this share of the rate it needs, a goal is at risk rather than on track. */
const AT_RISK_RATIO = 0.8

/** A streak below this share of its weekly target has stopped being a habit. */
const STREAK_STALLED_RATIO = 0.6

export function progress(goal: Goal): Progress {
  const history = [...goal.history].sort((a, b) => b.daysAgo - a.daysAgo)
  const current = history.length > 0 ? history[history.length - 1].value : goal.startValue

  const span = goal.targetValue - goal.startValue || 1
  const percent =
    goal.kind === 'milestone'
      ? current >= goal.targetValue
        ? 100
        : 0
      : Math.max(0, Math.min(100, ((current - goal.startValue) / span) * 100))

  const daysLeft = goal.deadlineInDays
  const totalDays = Math.max(1, goal.ageInDays + Math.max(0, daysLeft))
  const expectedPercent = Math.min(100, (Math.max(1, goal.ageInDays) / totalDays) * 100)

  // The oldest point still inside the window, or the oldest there is. Falling
  // back matters: a goal with three months of history and one check-in this
  // month would otherwise measure its recent rate against itself and get zero.
  const inWindow = history.filter((p) => p.daysAgo <= WINDOW)
  const from30 = inWindow.length > 1 ? inWindow[0] : (history[0] ?? { daysAgo: 1, value: current })
  const rate30 =
    from30.daysAgo > 0 ? (current - from30.value) / Math.max(1, from30.daysAgo) : 0

  const oldest = history[0] ?? { daysAgo: 1, value: current }
  const rateAll = oldest.daysAgo > 0 ? (current - oldest.value) / Math.max(1, oldest.daysAgo) : 0

  const neededRate = daysLeft > 0 ? (goal.targetValue - current) / daysLeft : 0

  const project = (rate: number): number | null =>
    rate > 0 && current < goal.targetValue ? Math.ceil((goal.targetValue - current) / rate) : null

  // How long the current value has stood. The first point that already held it
  // is where the flat stretch began.
  const unchanged = history.filter((p) => p.value === current)
  const stalledDays = unchanged.length > 1 ? unchanged[0].daysAgo : 0

  return {
    current,
    percent,
    expectedPercent,
    daysLeft,
    status: statusOf(goal, { percent, current, rate30, neededRate, stalledDays, daysLeft }),
    rate30,
    rateAll,
    neededRate,
    projected30: project(rate30),
    projectedAll: project(rateAll),
    stalledDays,
  }
}

function statusOf(
  goal: Goal,
  m: {
    percent: number
    current: number
    rate30: number
    neededRate: number
    stalledDays: number
    daysLeft: number
  },
): Status {
  // A habit is judged on this week, not on a trend, and it is never done: "cook
  // five nights a week" is a thing you keep doing. Hitting the number this week
  // means on track. This is checked before the done rule for that reason.
  if (goal.kind === 'streak') {
    if (m.current >= goal.targetValue) return 'on_track'
    return m.current >= goal.targetValue * STREAK_STALLED_RATIO ? 'at_risk' : 'stalled'
  }

  if (m.percent >= 100) return 'done'

  // A milestone is binary, so there is no pace to read. The only signal is how
  // close the deadline is.
  if (goal.kind === 'milestone') {
    return m.daysLeft < WINDOW ? 'at_risk' : 'on_track'
  }

  if (m.stalledDays >= WINDOW) return 'stalled'
  if (m.neededRate > 0 && m.rate30 < m.neededRate * AT_RISK_RATIO) return 'at_risk'
  return 'on_track'
}

/** "$216,384", "320 lb", "3/wk", "Done". How a value reads for its kind. */
export function formatValue(value: number, kind: GoalKind, unit: string): string {
  if (kind === 'milestone') return value >= 1 ? 'Done' : 'Not yet'
  if (unit === '$') return `$${Math.round(value).toLocaleString()}`

  const rounded = Math.round(value * 10) / 10
  if (unit === '/wk') return `${rounded.toLocaleString()}/wk`
  return unit ? `${rounded.toLocaleString()} ${unit}` : rounded.toLocaleString()
}

/**
 * One sentence saying why a goal has the status it has. Never a bare label: the
 * point of the screen is that you can see the reasoning behind the colour.
 */
export function rule(goal: Goal, p: Progress, unit: string): string {
  if (p.status === 'done') return 'Target reached.'

  if (goal.kind === 'streak') {
    return `${formatValue(p.current, goal.kind, unit)} of ${formatValue(goal.targetValue, goal.kind, unit)} this week.`
  }

  if (goal.kind === 'milestone') {
    return p.daysLeft > 0 ? `Binary. Due in ${p.daysLeft} days.` : 'Overdue.'
  }

  if (p.status === 'stalled') return `No change in ${p.stalledDays} days.`

  const pace = formatValue(p.rate30 * 30, goal.kind, unit)
  const needed = formatValue(p.neededRate * 30, goal.kind, unit)
  const share = p.neededRate > 0 ? Math.round((p.rate30 / p.neededRate) * 100) : 100
  return `Pace ${pace}/mo vs ${needed}/mo needed (${share}%).`
}

/**
 * The drawer's Status rule paragraph: the same arithmetic as rule(), written
 * out with the thresholds, so the reader can check the status by hand.
 */
export function ruleLong(goal: Goal, p: Progress, unit: string, deadlineLabel: string): string {
  if (p.status === 'done') return 'Target reached. Archive it or raise the target.'
  if (goal.kind === 'milestone') {
    return 'Milestones are binary. At risk when under 30 days remain and it is not done.'
  }
  if (goal.kind === 'streak') {
    return `Habit goals compare this week's count (${p.current}) with the target (${goal.targetValue}). Under 60% is stalled.`
  }
  const needed = formatValue(p.neededRate * 30, goal.kind, unit)
  const pace = formatValue(p.rate30 * 30, goal.kind, unit)
  const share = p.neededRate > 0 ? Math.round((p.rate30 / p.neededRate) * 100) : 100
  return `You need ${needed}/mo to hit ${formatValue(goal.targetValue, goal.kind, unit)} by ${deadlineLabel}. Last 30 days you did ${pace} per month, which is ${share}% of the needed pace. Under 80% flags at risk; no change for 30 days flags stalled.`
}

export type HistoryPaths = {
  path: string
  area: string
  dots: { x: number; y: number; manual: boolean }[]
  targetY: number
  paceY1: number
  paceY2: number
  /** Days ago the chart starts. */
  spanDays: number
}

/**
 * The drawer's history chart in a 400 by 110 box: values scale from the lower
 * of start and history to the higher of target and history, so a target line
 * always fits and a value past it stretches the scale instead of clipping.
 */
export function historyPaths(goal: Goal, p: Progress): HistoryPaths {
  const history = [...goal.history].sort((a, b) => b.daysAgo - a.daysAgo)
  const values = history.map((h) => h.value)
  const lo = Math.min(goal.startValue, ...values)
  const hi = Math.max(goal.targetValue, ...values)
  const spanDays = Math.max(1, history[0]?.daysAgo ?? 1)
  const Y = (v: number) => round(100 - ((v - lo) / (hi - lo || 1)) * 90)
  const X = (ago: number) => round(400 - (ago / spanDays) * 400)

  const dots = history.map((h) => ({ x: X(h.daysAgo), y: Y(h.value), manual: h.manual === true }))
  const path = dots.map((d, i) => `${i ? 'L' : 'M'}${d.x.toFixed(1)},${d.y.toFixed(1)}`).join(' ')
  const area = dots.length
    ? `${path} L400,100 L${dots[0].x.toFixed(1)},100 Z`
    : ''
  const span = goal.targetValue - goal.startValue
  return {
    path,
    area,
    dots,
    targetY: Y(goal.targetValue),
    paceY1: Y(goal.startValue),
    paceY2: Y(goal.startValue + span * Math.min(1, p.expectedPercent / 100)),
    spanDays,
  }
}

const round = (n: number) => Math.round(n * 10) / 10
