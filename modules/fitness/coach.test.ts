import { describe, expect, it } from 'vitest'
import { review, type CoachInput } from './coach'

const week = (over: Partial<CoachInput> = {}): CoachInput => ({
  loadThisWeek: 100,
  loadLastWeek: 100,
  daysSinceLast: 1,
  workoutsThisWeek: 3,
  daysPerWeek: 3,
  stalled: [],
  ...over,
})

describe('review', () => {
  it('says nothing when the week was ordinary and nothing is stalled', () => {
    // A coach that proposes something every week is noise, and noise in the
    // Review inbox is how an inbox stops being read.
    expect(review(week({ workoutsThisWeek: 2, loadThisWeek: 90 }))).toEqual([])
  })

  it('answers a layoff with one thing and drops the rest', () => {
    const out = review(week({ daysSinceLast: 21, workoutsThisWeek: 0, loadThisWeek: 0, stalled: [{ exercise: 'Squat', sessions: 5 }] }))

    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('restart')
    expect(out[0].reason).toContain('21 days')
  })

  it('flags a volume spike', () => {
    const out = review(week({ loadLastWeek: 100, loadThisWeek: 180 }))
    expect(out[0]).toMatchObject({ kind: 'deload' })
    expect(out[0].reason).toContain('80 percent')
  })

  it('leaves a normal increase alone', () => {
    expect(review(week({ loadLastWeek: 100, loadThisWeek: 130 })).filter((s) => s.kind === 'deload')).toEqual([])
  })

  it('calls a stall a stall only after three sessions', () => {
    // Two sessions without a best is a bad day and a good one. Nothing is said
    // about the lift, and the week is otherwise good enough to progress.
    const quiet = review(week({ stalled: [{ exercise: 'Bench', sessions: 2 }] }))
    expect(quiet.map((s) => s.kind)).not.toContain('deload')
    expect(quiet.some((s) => s.headline.includes('Bench'))).toBe(false)

    const out = review(week({ stalled: [{ exercise: 'Bench', sessions: 4 }] }))
    expect(out).toHaveLength(1)
    expect(out[0].headline).toContain('Bench')
  })

  it('asks for a session back when the week fell short and load fell with it', () => {
    const out = review(week({ workoutsThisWeek: 1, loadThisWeek: 60, loadLastWeek: 100 }))
    expect(out.map((s) => s.kind)).toContain('add-session')
  })

  it('does not ask for a session when there is no plan to fall short of', () => {
    // Zero days a week is no plan, and inventing a target to miss is how a
    // screen starts nagging about something the owner never agreed to.
    const out = review(week({ daysPerWeek: 0, workoutsThisWeek: 1, loadThisWeek: 60, loadLastWeek: 100 }))
    expect(out).toEqual([])
  })

  it('offers progression only when the week actually went to plan', () => {
    const out = review(week({ workoutsThisWeek: 3, daysPerWeek: 3, loadThisWeek: 110, loadLastWeek: 100 }))
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('progress')

    // And never alongside a warning: back off and add weight is not advice.
    const spike = review(week({ loadThisWeek: 200, loadLastWeek: 100 }))
    expect(spike.map((s) => s.kind)).not.toContain('progress')
  })

  it('does not divide by a week that never happened', () => {
    // First week ever: last week is zero, so there is no ratio to take. It must
    // not read as an infinite spike, and it must not read as a collapse.
    const out = review(week({ loadLastWeek: 0, loadThisWeek: 50, daysSinceLast: null }))
    expect(out.map((s) => s.kind)).not.toContain('deload')
    expect(out.map((s) => s.kind)).not.toContain('add-session')
    for (const s of out) expect(s.reason).not.toContain('Infinity')
  })
})
