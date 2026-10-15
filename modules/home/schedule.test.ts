import { describe, expect, it } from 'vitest'
import {
  addMonths,
  compactMoney,
  dueLabel,
  dueStatus,
  intervalLabel,
  logDate,
  monthLabelLong,
  monthYear,
  next12Months,
  nextDue,
} from './schedule'

const service = (over: Partial<Parameters<typeof nextDue>[0]> = {}) => ({
  intervalMonths: 12,
  lastDoneOn: null,
  dueOn: null,
  snoozeUntil: null,
  ...over,
})

describe('addMonths', () => {
  it('clamps to the end of a shorter month', () => {
    // Six months after the end of August is the end of February, not the third
    // of March. Rolling over walks a job later every time it runs.
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
  })

  it('keeps the day when the target month is long enough', () => {
    expect(addMonths('2026-03-15', 3)).toBe('2026-06-15')
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15')
  })
})

describe('nextDue', () => {
  it('is the interval from the last time it was done', () => {
    expect(nextDue(service({ intervalMonths: 6, lastDoneOn: '2026-05-22' }))).toBe('2026-11-22')
  })

  it('takes an explicit date over the interval', () => {
    // The shop said November. The interval is only a guess at the same thing.
    expect(nextDue(service({ intervalMonths: 6, lastDoneOn: '2026-05-22', dueOn: '2026-11-04' })))
      .toBe('2026-11-04')
  })

  it('is null when it has never been done and has no date', () => {
    expect(nextDue(service())).toBeNull()
  })

  it('is null for a zero interval, which is a one-off', () => {
    expect(nextDue(service({ intervalMonths: 0, lastDoneOn: '2026-05-22' }))).toBeNull()
  })
})

describe('dueStatus', () => {
  const today = '2026-09-08'

  it('separates never scheduled from overdue', () => {
    // A job nobody put on the calendar is not late. Calling it overdue would
    // invent a commitment that was never made.
    expect(dueStatus(service(), today)).toBe('unscheduled')
    expect(dueStatus(service({ dueOn: '2026-07-01' }), today)).toBe('overdue')
  })

  it('reads the rest of this month as due now', () => {
    expect(dueStatus(service({ dueOn: '2026-09-30' }), today)).toBe('due')
    expect(dueStatus(service({ dueOn: '2026-09-08' }), today)).toBe('due')
  })

  it('distinguishes soon from later', () => {
    expect(dueStatus(service({ dueOn: '2026-10-10' }), today)).toBe('soon')
    expect(dueStatus(service({ dueOn: '2027-03-10' }), today)).toBe('later')
  })

  it('lets a snooze hide an overdue job until the day it lands', () => {
    const snoozed = service({ dueOn: '2026-07-01', snoozeUntil: '2026-10-01' })
    expect(dueStatus(snoozed, today)).toBe('snoozed')
    // And it comes back, rather than being dismissed for good.
    expect(dueStatus(snoozed, '2026-10-02')).toBe('overdue')
  })
})

describe('dueLabel', () => {
  it('says how late in a unit that fits', () => {
    expect(dueLabel(service({ dueOn: '2026-09-01' }), '2026-09-08')).toBe('7 days overdue')
    expect(dueLabel(service({ dueOn: '2026-08-01' }), '2026-09-08')).toBe('5 weeks overdue')
    expect(dueLabel(service({ dueOn: '2026-03-01' }), '2026-09-08')).toBe('6 months overdue')
  })

  it('says nothing scheduled rather than guessing a date', () => {
    expect(dueLabel(service(), '2026-09-08')).toBe('nothing scheduled')
  })
})

describe('next12Months', () => {
  const jobs = [
    { dueOn: '2026-09-20', costEstimateCents: 34_000 },
    { dueOn: '2026-09-28', costEstimateCents: 18_000 },
    { dueOn: '2026-12-02', costEstimateCents: 22_000 },
    // Outside the window: thirteen months out is next year's problem.
    { dueOn: '2027-11-02', costEstimateCents: 99_900 },
  ]

  it('starts at this month and always runs twelve', () => {
    const months = next12Months(jobs, '2026-09-08')
    expect(months).toHaveLength(12)
    expect(months[0]).toMatchObject({ key: '2026-09', label: 'Sep 26', isCurrent: true })
    expect(months[11].key).toBe('2027-08')
  })

  it('keeps empty months, because an empty month is information', () => {
    const months = next12Months(jobs, '2026-09-08')
    expect(months[1]).toMatchObject({ key: '2026-10', count: 0, costCents: 0 })
  })

  it('totals the estimates in a month', () => {
    const months = next12Months(jobs, '2026-09-08')
    expect(months[0]).toMatchObject({ count: 2, costCents: 52_000 })
    expect(months[3]).toMatchObject({ key: '2026-12', count: 1, costCents: 22_000 })
  })

  it('crosses the year end without losing a month', () => {
    const months = next12Months(jobs, '2026-11-08')
    expect(months.map((m) => m.key)).toContain('2027-01')
    expect(months[0].key).toBe('2026-11')
  })
})

describe('labels for the screen', () => {
  it('writes the selected month with its full year', () => {
    expect(monthLabelLong('2026-09')).toBe('Sep 2026')
  })

  it('names an interval the way a person says it', () => {
    expect(intervalLabel(12)).toBe('yearly')
    expect(intervalLabel(6)).toBe('twice a year')
    expect(intervalLabel(24)).toBe('every 2 years')
    expect(intervalLabel(0)).toBe('one off')
    expect(intervalLabel(3)).toBe('every 3 months')
  })

  it('compacts money on the strip past ten thousand', () => {
    expect(compactMoney(261_700)).toBe('$2,617')
    expect(compactMoney(2_131_000)).toBe('$21.3k')
    expect(compactMoney(74_314_000)).toBe('$743k')
    expect(compactMoney(10_000_000)).toBe('$100k')
  })

  it('dates a log row and a vendor the way the drawer and the rail read them', () => {
    expect(logDate('2026-09-05')).toBe('05 Sep 26')
    expect(monthYear('2026-07-12')).toBe('Jul 2026')
  })
})
