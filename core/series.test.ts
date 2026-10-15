import { describe, expect, it } from 'vitest'
import { spine } from './series'

// The chart used to draw whatever rows came back, evenly spaced. Two days of
// balances became a two point line across the full width, which reads as a
// month of history and is a lie about how long the account has been synced.
// spine() puts the readings on a real date axis instead.

const TODAY = '2026-09-15'

describe('spine', () => {
  it('returns one entry per day, oldest first, ending on today', () => {
    const days = spine([], 30, TODAY)

    expect(days).toHaveLength(30)
    expect(days[0].date).toBe('2026-08-17')
    expect(days[29].date).toBe(TODAY)
  })

  it('puts a reading on its own date', () => {
    const days = spine([{ on_date: '2026-09-15', cents: 500_00 }], 30, TODAY)

    expect(days[29]).toEqual({ date: '2026-09-15', cents: 500_00, observed: true })
  })

  it('leaves the days before the first reading null', () => {
    // Two days of history is the case this exists for: the owner connected the
    // bank yesterday, and the month before that is not zero, it is unknown.
    const days = spine(
      [
        { on_date: '2026-09-14', cents: 100_00 },
        { on_date: '2026-09-15', cents: 110_00 },
      ],
      30,
      TODAY,
    )

    expect(days.slice(0, 28).every((d) => d.cents === null && !d.observed)).toBe(true)
    expect(days[28]).toEqual({ date: '2026-09-14', cents: 100_00, observed: true })
    expect(days[29]).toEqual({ date: '2026-09-15', cents: 110_00, observed: true })
  })

  it('carries the last reading forward across a gap', () => {
    // A missed sync does not mean the money left. Once there is a reading, the
    // balance holds until a later one says otherwise.
    const days = spine(
      [
        { on_date: '2026-09-12', cents: 200_00 },
        { on_date: '2026-09-15', cents: 250_00 },
      ],
      30,
      TODAY,
    )

    expect(days[26]).toEqual({ date: '2026-09-12', cents: 200_00, observed: true })
    expect(days[27]).toEqual({ date: '2026-09-13', cents: 200_00, observed: false })
    expect(days[28]).toEqual({ date: '2026-09-14', cents: 200_00, observed: false })
    expect(days[29]).toEqual({ date: '2026-09-15', cents: 250_00, observed: true })
  })

  it('carries the last reading forward to today when the sync has stopped', () => {
    const days = spine([{ on_date: '2026-09-13', cents: 300_00 }], 30, TODAY)

    expect(days[27].cents).toBe(300_00)
    expect(days[28]).toEqual({ date: '2026-09-14', cents: 300_00, observed: false })
    expect(days[29]).toEqual({ date: '2026-09-15', cents: 300_00, observed: false })
  })

  it('averages the readings, not the days they were carried across', () => {
    // The whole reason observed exists. Carrying 200 across three days and
    // then reading 800 is an average of 500, not of 350: the 200 was measured
    // once, and repeating it on the axis must not weight it three times.
    const days = spine(
      [
        { on_date: '2026-09-12', cents: 200_00 },
        { on_date: '2026-09-15', cents: 800_00 },
      ],
      30,
      TODAY,
    )

    const readings = days.filter((d) => d.observed).map((d) => d.cents as number)
    expect(readings).toEqual([200_00, 800_00])
    expect(readings.reduce((a, b) => a + b, 0) / readings.length).toBe(500_00)
  })

  it('is all nulls when nothing has been synced', () => {
    const days = spine([], 30, TODAY)

    expect(days.every((d) => d.cents === null && !d.observed)).toBe(true)
  })

  it('ignores a reading older than the window', () => {
    // Older than the window is not the same as unknown: the query is meant to
    // bound this, and a row that slips through must not redraw the first day.
    const days = spine(
      [
        { on_date: '2026-07-01', cents: 999_00 },
        { on_date: '2026-09-15', cents: 100_00 },
      ],
      30,
      TODAY,
    )

    expect(days[0].cents).toBe(null)
    expect(days[29].cents).toBe(100_00)
  })

  it('ignores a reading dated after today', () => {
    const days = spine([{ on_date: '2026-09-16', cents: 1_00 }], 30, TODAY)

    expect(days.every((d) => d.cents === null)).toBe(true)
  })

  it('does not depend on the order the readings arrive in', () => {
    const days = spine(
      [
        { on_date: '2026-09-15', cents: 250_00 },
        { on_date: '2026-09-12', cents: 200_00 },
      ],
      30,
      TODAY,
    )

    expect(days[26].cents).toBe(200_00)
    expect(days[29].cents).toBe(250_00)
  })

  it('steps across a month boundary without drifting', () => {
    // Date arithmetic in UTC, because todayIso is already the owner's date and
    // re-reading it through the server's timezone would shift it by a day.
    const days = spine([], 30, '2026-03-02')

    expect(days[0].date).toBe('2026-02-01')
    expect(days[29].date).toBe('2026-03-02')
  })

  it('honours a window other than 30', () => {
    const days = spine([{ on_date: '2026-09-15', cents: 1_00 }], 7, TODAY)

    expect(days).toHaveLength(7)
    expect(days[0].date).toBe('2026-09-09')
    expect(days[6].cents).toBe(1_00)
  })
})
