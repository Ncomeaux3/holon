import { describe, expect, it } from 'vitest'
import { nextAfter, nextDue, projectDue, repeatLabel, sameRule } from './repeat'

describe('nextDue', () => {
  it('steps a day, or an interval of days', () => {
    expect(nextDue({ every: 'day' }, '2026-09-30')).toBe('2026-10-01')
    expect(nextDue({ every: 'day', interval: 3 }, '2026-09-30')).toBe('2026-10-03')
  })

  it('steps a week from the same weekday when no days are named', () => {
    expect(nextDue({ every: 'week' }, '2026-09-23')).toBe('2026-09-30')
    expect(nextDue({ every: 'week', interval: 2 }, '2026-09-23')).toBe('2026-10-07')
  })

  it('walks a weekly set to the next named day, wrapping to the next week', () => {
    // 2026-09-23 is a Wednesday. Monday and Friday.
    expect(nextDue({ every: 'week', on: [1, 5] }, '2026-09-23')).toBe('2026-09-25')
    expect(nextDue({ every: 'week', on: [1, 5] }, '2026-09-25')).toBe('2026-09-28')
    expect(nextDue({ every: 'week', on: [1, 5], interval: 2 }, '2026-09-25')).toBe('2026-10-05')
  })

  it('keeps a monthly day and clamps to the month end without drifting', () => {
    expect(nextDue({ every: 'month', on: [31] }, '2026-01-31')).toBe('2026-02-28')
    expect(nextDue({ every: 'month', on: [31] }, '2026-02-28')).toBe('2026-03-31')
    expect(nextDue({ every: 'month', on: [31] }, '2028-01-31')).toBe('2028-02-29')
  })

  it('takes the day of the from date when a monthly rule names none', () => {
    expect(nextDue({ every: 'month' }, '2026-09-15')).toBe('2026-10-15')
    expect(nextDue({ every: 'month', interval: 3 }, '2026-11-15')).toBe('2027-02-15')
  })

  it('reaches a named day later in the same month', () => {
    expect(nextDue({ every: 'month', on: [15] }, '2026-09-03')).toBe('2026-09-15')
  })

  it('treats -1 as the last day of each month', () => {
    expect(nextDue({ every: 'month', on: [-1] }, '2026-01-31')).toBe('2026-02-28')
    expect(nextDue({ every: 'month', on: [-1] }, '2026-02-28')).toBe('2026-03-31')
    expect(nextDue({ every: 'month', on: [-1] }, '2026-04-10')).toBe('2026-04-30')
  })

  it('steps a year, clamping 29 February', () => {
    expect(nextDue({ every: 'year' }, '2026-09-23')).toBe('2027-09-23')
    expect(nextDue({ every: 'year' }, '2028-02-29')).toBe('2029-02-28')
  })
})

describe('nextAfter', () => {
  it('steps from the due date when that is still ahead of today', () => {
    expect(nextAfter({ every: 'month', on: [30] }, '2026-09-30', '2026-09-05')).toBe('2026-10-30')
  })

  it('skips the dates a late completion already missed', () => {
    expect(nextAfter({ every: 'month', on: [1] }, '2026-07-01', '2026-09-20')).toBe('2026-10-01')
  })

  it('counts from today when the task had no due date', () => {
    expect(nextAfter({ every: 'week' }, null, '2026-09-23')).toBe('2026-09-30')
  })
})

describe('projectDue', () => {
  it('lists every date after the first through the end, inclusive', () => {
    expect(projectDue({ every: 'week' }, '2026-09-02', '2026-09-30')).toEqual([
      '2026-09-09',
      '2026-09-16',
      '2026-09-23',
      '2026-09-30',
    ])
  })

  it('is empty when the next date falls past the end', () => {
    expect(projectDue({ every: 'month' }, '2026-09-15', '2026-10-14')).toEqual([])
  })
})

describe('sameRule', () => {
  it('matches a rule whatever order its keys and days come back in', () => {
    const saved = JSON.parse('{"on": [5, 1], "every": "week"}')
    expect(sameRule(saved, { every: 'week', on: [1, 5] })).toBe(true)
    expect(sameRule({ every: 'month', on: [23], interval: 1 }, { every: 'month', on: [23] })).toBe(true)
  })

  it('tells different rules apart', () => {
    expect(sameRule({ every: 'month', on: [23] }, { every: 'month', on: [-1] })).toBe(false)
    expect(sameRule({ every: 'week' }, { every: 'week', interval: 2 })).toBe(false)
    expect(sameRule({ every: 'day' }, { every: 'week' })).toBe(false)
  })
})

describe('repeatLabel', () => {
  it('names each rule the way the drawer shows it', () => {
    expect(repeatLabel({ every: 'day' })).toBe('Daily')
    expect(repeatLabel({ every: 'week', on: [3] })).toBe('Weekly on Wed')
    expect(repeatLabel({ every: 'week', on: [1, 5] })).toBe('Weekly on Mon, Fri')
    expect(repeatLabel({ every: 'month', on: [23] })).toBe('Monthly on the 23rd')
    expect(repeatLabel({ every: 'month', on: [1] })).toBe('Monthly on the 1st')
    expect(repeatLabel({ every: 'month', on: [12] })).toBe('Monthly on the 12th')
    expect(repeatLabel({ every: 'month', on: [-1] })).toBe('Monthly on the last day')
    expect(repeatLabel({ every: 'year' })).toBe('Yearly')
    expect(repeatLabel({ every: 'month', on: [1], interval: 2 })).toBe('Every 2 months on the 1st')
  })
})
