import { describe, expect, it } from 'vitest'
import { formatValue, historyPaths, progress, rule, ruleLong, type Goal, type Point } from './progress'

// The status rules and the two projections are the whole reason this screen is
// worth building: they turn a list of numbers into "this one is not going to
// make it". Every one of them is arithmetic on the check-in history, so every
// one of them is testable, and none of them is allowed to be a guess.

const points = (...pairs: [number, number][]): Point[] =>
  pairs.map(([daysAgo, value]) => ({ daysAgo, value }))

const goal = (over: Partial<Goal> = {}): Goal => ({
  kind: 'number',
  startValue: 0,
  targetValue: 100,
  deadlineInDays: 100,
  ageInDays: 100,
  history: points([100, 0], [0, 50]),
  ...over,
})

describe('progress', () => {
  it('reads the newest point as the current value', () => {
    expect(progress(goal()).current).toBe(50)
  })

  it('falls back to the start value when nothing has been recorded', () => {
    expect(progress(goal({ startValue: 12, history: [] })).current).toBe(12)
  })

  it('measures percent against the span, not against the target', () => {
    // 255 to 385, currently 320: 65 of 130.
    const p = progress(
      goal({ startValue: 255, targetValue: 385, history: points([180, 255], [0, 320]) }),
    )
    expect(Math.round(p.percent)).toBe(50)
  })

  it('clamps percent, because a goal cannot be 140 percent done', () => {
    expect(progress(goal({ history: points([100, 0], [0, 140]) })).percent).toBe(100)
    expect(progress(goal({ history: points([100, 0], [0, -20]) })).percent).toBe(0)
  })
})

describe('status', () => {
  it('is done the moment the target is reached', () => {
    expect(progress(goal({ history: points([100, 0], [0, 100]) })).status).toBe('done')
  })

  it('is on track while the recent pace is close to what is needed', () => {
    // Half way with half the time gone.
    expect(progress(goal({ history: points([100, 0], [30, 35], [0, 50]) })).status).toBe('on_track')
  })

  it('is at risk when the recent pace falls below four fifths of what is needed', () => {
    // 90 to go in 100 days needs 0.9/day. The last 30 days ran at 0.1/day.
    const p = progress(goal({ history: points([100, 0], [30, 7], [0, 10]) }))
    expect(p.status).toBe('at_risk')
  })

  it('is stalled when the value has not moved in a month', () => {
    const p = progress(goal({ history: points([100, 0], [40, 50], [10, 50], [0, 50]) }))
    expect(p.stalledDays).toBe(40)
    expect(p.status).toBe('stalled')
  })

  it('judges a habit on this week rather than on a trend', () => {
    const habit = (current: number) =>
      progress(
        goal({
          kind: 'streak',
          startValue: 0,
          targetValue: 5,
          history: points([30, 0], [0, current]),
        }),
      ).status

    // Never 'done': a habit is something you keep doing, so hitting the number
    // this week is on track, not finished.
    expect(habit(5)).toBe('on_track')
    expect(habit(8)).toBe('on_track')
    expect(habit(3)).toBe('at_risk')
    expect(habit(1)).toBe('stalled')
  })

  it('judges a milestone only by how close the deadline is', () => {
    const milestone = (deadlineInDays: number) =>
      progress(
        goal({
          kind: 'milestone',
          startValue: 0,
          targetValue: 1,
          deadlineInDays,
          history: points([20, 0], [0, 0]),
        }),
      ).status

    expect(milestone(200)).toBe('on_track')
    expect(milestone(10)).toBe('at_risk')
  })
})

describe('projection', () => {
  it('projects from the recent rate and from the lifetime rate separately', () => {
    // Lifetime 0.5/day, last 30 days 1/day, 50 to go.
    const p = progress(goal({ history: points([100, 0], [30, 20], [0, 50]) }))
    expect(p.projected30).toBe(50 / ((50 - 20) / 30))
    expect(p.projectedAll).toBe(100)
  })

  it('says never rather than inventing a date when nothing is moving', () => {
    const p = progress(goal({ history: points([100, 50], [30, 50], [0, 50]) }))
    expect(p.projected30).toBeNull()
    expect(p.projectedAll).toBeNull()
  })

  it('measures the recent rate against the oldest point when the window is thin', () => {
    // One check-in inside 30 days would otherwise be compared with itself and
    // read as zero movement on a goal that is clearly moving.
    const p = progress(goal({ history: points([90, 0], [5, 45]) }))
    expect(p.rate30).toBeGreaterThan(0)
    expect(p.projected30).not.toBeNull()
  })
})

describe('formatValue', () => {
  it('writes money as money and a habit as a rate', () => {
    expect(formatValue(216_384, 'number', '$')).toBe('$216,384')
    expect(formatValue(3, 'streak', '/wk')).toBe('3/wk')
    expect(formatValue(340, 'number', 'lb')).toBe('340 lb')
    expect(formatValue(7, 'count', '')).toBe('7')
  })

  it('says whether a milestone happened, not how far along it is', () => {
    expect(formatValue(0, 'milestone', '')).toBe('Not yet')
    expect(formatValue(1, 'milestone', '')).toBe('Done')
  })
})

describe('rule', () => {
  it('explains the colour rather than only showing it', () => {
    const stalled = goal({ history: points([100, 0], [40, 50], [0, 50]) })
    expect(rule(stalled, progress(stalled), '')).toBe('No change in 40 days.')

    const done = goal({ history: points([100, 0], [0, 100]) })
    expect(rule(done, progress(done), '')).toBe('Target reached.')

    const habit = goal({ kind: 'streak', targetValue: 5, history: points([30, 0], [0, 3]) })
    expect(rule(habit, progress(habit), '/wk')).toBe('3/wk of 5/wk this week.')
  })

  it('gives a pace against the pace needed, with the share it is running at', () => {
    const g = goal({ history: points([100, 0], [30, 7], [0, 10]) })
    expect(rule(g, progress(g), '')).toMatch(/Pace 3\/mo vs 27\/mo needed \(11%\)\./)
  })
})

describe('ruleLong', () => {
  it('writes the needed pace, the recent pace and its share, then the thresholds', () => {
    const g = goal({ history: points([100, 0], [30, 35], [0, 50]) })
    const p = progress(g)
    const text = ruleLong(g, p, '', 'Dec 20')
    expect(text).toMatch(/^You need [\d.]+\/mo to hit 100 by Dec 20\. Last 30 days you did [\d.]+ per month, which is \d+% of the needed pace\. Under 80% flags at risk; no change for 30 days flags stalled\.$/)
  })

  it('has a sentence for each kind and for done', () => {
    const streak = goal({ kind: 'streak', targetValue: 5, history: points([7, 3], [0, 3]) })
    expect(ruleLong(streak, progress(streak), '/wk', '')).toBe(
      "Habit goals compare this week's count (3) with the target (5). Under 60% is stalled.",
    )
    const ms = goal({ kind: 'milestone', targetValue: 1, history: points([10, 0], [0, 0]) })
    expect(ruleLong(ms, progress(ms), '', '')).toMatch(/^Milestones are binary/)
    const done = goal({ history: points([100, 0], [0, 100]) })
    expect(ruleLong(done, progress(done), '', '')).toBe('Target reached. Archive it or raise the target.')
  })
})

describe('historyPaths', () => {
  it('draws one command per point, the target at the top and the start at the bottom', () => {
    const g = goal({ history: points([100, 0], [0, 50]) })
    const h = historyPaths(g, progress(g))
    expect(h.path.split(' ')).toHaveLength(2)
    expect(h.path.startsWith('M0.0,100.0')).toBe(true)
    expect(h.targetY).toBe(10)
    expect(h.dots).toHaveLength(2)
    expect(h.dots[1]).toMatchObject({ x: 400, y: 55 })
    // Half way through the window, the needed pace line has reached the middle.
    expect(h.paceY2).toBe(55)
  })

  it('stretches the scale to a value past the target rather than clipping it', () => {
    const g = goal({ history: points([100, 0], [0, 140]) })
    const h = historyPaths(g, progress(g))
    expect(h.targetY).toBeGreaterThan(10)
    expect(h.dots[1].y).toBe(10)
  })
})
