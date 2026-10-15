import { describe, expect, it } from 'vitest'
import { dueOn, screeningLabel, screeningStatus, streak } from './screening'

const TODAY = '2026-09-08'

const screening = (lastDoneOn: string | null, intervalMonths = 12, snoozeUntil: string | null = null) => ({
  intervalMonths,
  lastDoneOn,
  snoozeUntil,
})

describe('dueOn', () => {
  it('adds the interval in months, not in days', () => {
    // Twelve months from a February date is the same date next February, not
    // 365 days later, which would drift a day every leap year.
    expect(dueOn(screening('2026-02-28', 12))).toBe('2027-02-28')
    expect(dueOn(screening('2026-09-08', 6))).toBe('2027-03-08')
  })

  it('has no answer when there is no baseline', () => {
    expect(dueOn(screening(null))).toBeNull()
  })
})

describe('screeningStatus', () => {
  it('separates never having had one from being late for one', () => {
    // Folding these together would show a screening you have never had as
    // decades overdue, which invents a history that does not exist.
    expect(screeningStatus(screening(null), TODAY)).toBe('never')
    expect(screeningStatus(screening('2024-01-01', 12), TODAY)).toBe('overdue')
  })

  it('calls the due date itself due', () => {
    expect(screeningStatus(screening('2025-09-08', 12), TODAY)).toBe('due')
  })

  it('warns inside two months and stays quiet before that', () => {
    // Due 2026-10-08, a month away.
    expect(screeningStatus(screening('2025-10-08', 12), TODAY)).toBe('soon')
    // Due 2027-01-08, four months away.
    expect(screeningStatus(screening('2026-01-08', 12), TODAY)).toBe('ok')
  })

  it('lets a live snooze win, and a passed one lose', () => {
    expect(screeningStatus(screening('2024-01-01', 12, '2026-12-01'), TODAY)).toBe('snoozed')
    expect(screeningStatus(screening('2024-01-01', 12, '2026-01-01'), TODAY)).toBe('overdue')
  })
})

describe('screeningLabel', () => {
  it('says what it is rather than only how it feels', () => {
    expect(screeningLabel(screening(null), TODAY)).toBe('never had one')
    expect(screeningLabel(screening('2025-09-08', 12), TODAY)).toBe('due today')
  })

  it('switches from days to months once days stop being useful', () => {
    expect(screeningLabel(screening('2025-08-01', 12), TODAY)).toBe('38 days overdue')
    // Due 2025-01-01, so 615 days late, which is 20.5 months and rounds up.
    expect(screeningLabel(screening('2024-01-01', 12), TODAY)).toBe('21 months overdue')
  })

  it('reads ahead in the unit that fits', () => {
    expect(screeningLabel(screening('2025-09-15', 12), TODAY)).toBe('due in 7 days')
    expect(screeningLabel(screening('2025-10-08', 12), TODAY)).toBe('due in 4 weeks')
    expect(screeningLabel(screening('2026-03-08', 12), TODAY)).toBe('due in 6 months')
  })
})

describe('streak', () => {
  const days = (...offsets: number[]) =>
    offsets.map((n) =>
      new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10),
    )

  it('counts back from today', () => {
    expect(streak(days(0, 1, 2, 3), TODAY)).toBe(4)
  })

  it('does not break because today is not marked yet', () => {
    // It is not the end of the day. Punishing an unmarked today at 9am would
    // make the number useless every morning.
    expect(streak(days(1, 2, 3), TODAY)).toBe(3)
  })

  it('breaks on a missed yesterday', () => {
    expect(streak(days(0, 2, 3), TODAY)).toBe(1)
    expect(streak(days(2, 3, 4), TODAY)).toBe(0)
  })

  it('is zero when nothing has been marked', () => {
    expect(streak([], TODAY)).toBe(0)
  })
})
