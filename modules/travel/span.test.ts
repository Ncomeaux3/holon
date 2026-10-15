import { describe, expect, it } from 'vitest'
import { summarise } from './span'

// A trip's own destination, lat, lon, starts_on and ends_on stopped being the
// trip and became a summary of its destinations, so that every reader that
// already read those columns keeps working. This is the function that keeps
// the summary true.

const dest = (over: Partial<Parameters<typeof summarise>[0][number]> = {}) => ({
  name: 'Valencia',
  lat: 39.47,
  lon: -0.38,
  starts_on: '2026-10-01',
  ends_on: '2026-10-05',
  ...over,
})

describe('summarise', () => {
  it('is empty for a trip with no destinations', () => {
    // The wishlist: an idea with no place decided yet pins nothing and spans
    // nothing, and must not be given a date it never had.
    expect(summarise([])).toEqual({
      destination: '',
      lat: null,
      lon: null,
      starts_on: null,
      ends_on: null,
    })
  })

  it('is the destination itself when there is one', () => {
    expect(summarise([dest()])).toEqual({
      destination: 'Valencia',
      lat: 39.47,
      lon: -0.38,
      starts_on: '2026-10-01',
      ends_on: '2026-10-05',
    })
  })

  it('takes the place from the first destination and the span from all of them', () => {
    const summary = summarise([
      dest({ name: 'Valencia', lat: 39.47, lon: -0.38, starts_on: '2026-10-01', ends_on: '2026-10-05' }),
      dest({ name: 'Porto', lat: 41.15, lon: -8.61, starts_on: '2026-10-05', ends_on: '2026-10-09' }),
      dest({ name: 'Madrid', lat: 40.42, lon: -3.7, starts_on: '2026-10-09', ends_on: '2026-10-14' }),
    ])

    expect(summary).toEqual({
      destination: 'Valencia',
      lat: 39.47,
      lon: -0.38,
      starts_on: '2026-10-01',
      ends_on: '2026-10-14',
    })
  })

  it('spans the earliest start and the latest end, not the first and last rows', () => {
    // Position is the order the owner put them in, which is not always the
    // order they happen in: a flight home booked before the middle leg still
    // sits third in the list.
    const summary = summarise([
      dest({ name: 'Porto', starts_on: '2026-10-05', ends_on: '2026-10-09' }),
      dest({ name: 'Valencia', starts_on: '2026-10-01', ends_on: '2026-10-03' }),
      dest({ name: 'Madrid', starts_on: '2026-10-03', ends_on: '2026-10-05' }),
    ])

    expect(summary.destination).toBe('Porto')
    expect(summary.starts_on).toBe('2026-10-01')
    expect(summary.ends_on).toBe('2026-10-09')
  })

  it('ignores destinations with no dates when computing the span', () => {
    // A city added to a trip before anyone booked it must not erase the span
    // the booked cities already have.
    const summary = summarise([
      dest({ name: 'Valencia', starts_on: '2026-10-01', ends_on: '2026-10-05' }),
      dest({ name: 'Somewhere', starts_on: null, ends_on: null }),
      dest({ name: 'Madrid', starts_on: '2026-10-07', ends_on: '2026-10-11' }),
    ])

    expect(summary.starts_on).toBe('2026-10-01')
    expect(summary.ends_on).toBe('2026-10-11')
  })

  it('leaves the span null when no destination has dates', () => {
    const summary = summarise([
      dest({ starts_on: null, ends_on: null }),
      dest({ name: 'Porto', starts_on: null, ends_on: null }),
    ])

    expect(summary.starts_on).toBe(null)
    expect(summary.ends_on).toBe(null)
  })

  it('takes a half open span from the ends that exist', () => {
    // A trip that knows when it leaves and not when it returns is a real state
    // on the way to booked, and the start it does know is worth keeping.
    const summary = summarise([dest({ starts_on: '2026-10-01', ends_on: null })])

    expect(summary.starts_on).toBe('2026-10-01')
    expect(summary.ends_on).toBe(null)
  })

  it('keeps the first destination even when it has no coordinates', () => {
    // The place columns are the first row's, whatever that row knows. A trip
    // with no destination rows at all falls back to its own lat/lon; a trip
    // whose first city has not been geocoded yet has not been geocoded yet.
    const summary = summarise([
      dest({ name: 'Somewhere', lat: null, lon: null }),
      dest({ name: 'Porto', lat: 41.15, lon: -8.61 }),
    ])

    expect(summary.destination).toBe('Somewhere')
    expect(summary.lat).toBe(null)
    expect(summary.lon).toBe(null)
  })

  it('does not mutate what it is given', () => {
    const rows = [dest({ name: 'Porto', starts_on: '2026-10-05' }), dest({ name: 'Valencia' })]
    const before = JSON.stringify(rows)

    summarise(rows)

    expect(JSON.stringify(rows)).toBe(before)
  })
})
