import { describe, expect, it } from 'vitest'
import { blankRow, rowsFor, toDestinations } from './rows'

// The trip form edits a list of destinations. The list itself is the part
// worth pinning down: what it starts as for a trip that has destinations, for
// one that predates them, and for a trip that is being created; and what it
// turns into on the way to write_trip, which replaces the whole set with
// whatever this produces.

const trip = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  destination: 'Valencia',
  lat: 39.47,
  lon: -0.38,
  startsOn: '2026-10-01',
  endsOn: '2026-10-05',
  ...over,
})

const dest = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  tripId: 't1',
  name: 'Valencia',
  lat: 39.47,
  lon: -0.38,
  startsOn: '2026-10-01',
  endsOn: '2026-10-05',
  position: 0,
  ...over,
})

describe('rowsFor', () => {
  it('is one empty row for a new trip', () => {
    // Never zero rows: a form with nothing to type in has nowhere to start.
    const rows = rowsFor(null, [])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: '', lat: '', lon: '', start: '', end: '' })
  })

  it('is the trip destinations, in position order', () => {
    const rows = rowsFor(trip(), [
      dest({ id: 'd2', name: 'Porto', lat: 41.15, lon: -8.61, position: 1 }),
      dest({ id: 'd1', name: 'Valencia', position: 0 }),
    ])

    expect(rows.map((r) => r.name)).toEqual(['Valencia', 'Porto'])
    expect(rows[1]).toMatchObject({ name: 'Porto', lat: '41.15', lon: '-8.61' })
  })

  it('falls back to the trip own place when it has no destinations', () => {
    // Every trip written through write_trip without a set, and anything the
    // migration found nothing to backfill from. Opening the form must show
    // what the trip says rather than an empty row that would wipe it on save.
    const rows = rowsFor(trip(), [])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      name: 'Valencia',
      lat: '39.47',
      lon: '-0.38',
      start: '2026-10-01',
      end: '2026-10-05',
    })
  })

  it('is one empty row for a trip that names nowhere', () => {
    const rows = rowsFor(
      trip({ destination: '', lat: null, lon: null, startsOn: null, endsOn: null }),
      [],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: '', lat: '', lon: '' })
  })

  it('renders a null coordinate as an empty field, not as "null"', () => {
    const rows = rowsFor(trip(), [dest({ lat: null, lon: null })])

    expect(rows[0].lat).toBe('')
    expect(rows[0].lon).toBe('')
  })

  it('gives every row a key of its own', () => {
    const rows = rowsFor(trip(), [dest({ id: 'd1' }), dest({ id: 'd2', name: 'Porto', position: 1 })])

    expect(new Set(rows.map((r) => r.key)).size).toBe(2)
    expect(rows.every((r) => r.key !== '')).toBe(true)
  })

  it('keys a blank row uniquely each time, so two added rows do not collide', () => {
    expect(blankRow().key).not.toBe(blankRow().key)
  })
})

describe('toDestinations', () => {
  it('turns the rows into the write_trip payload', () => {
    const payload = toDestinations([
      { key: 'a', name: 'Valencia', lat: '39.47', lon: '-0.38', start: '2026-10-01', end: '2026-10-05' },
      { key: 'b', name: 'Porto', lat: '41.15', lon: '-8.61', start: '2026-10-05', end: '2026-10-09' },
    ])

    expect(payload).toEqual([
      { name: 'Valencia', lat: 39.47, lon: -0.38, starts_on: '2026-10-01', ends_on: '2026-10-05' },
      { name: 'Porto', lat: 41.15, lon: -8.61, starts_on: '2026-10-05', ends_on: '2026-10-09' },
    ])
  })

  it('drops a row with no name', () => {
    // The form always shows at least one row and the plus adds more, so an
    // untouched row is the normal case, not an error to report.
    const payload = toDestinations([
      { key: 'a', name: 'Valencia', lat: '39.47', lon: '-0.38', start: '', end: '' },
      { key: 'b', name: '   ', lat: '', lon: '', start: '', end: '' },
    ])

    expect(payload).toHaveLength(1)
    expect(payload[0].name).toBe('Valencia')
  })

  it('trims the name', () => {
    const payload = toDestinations([
      { key: 'a', name: '  Valencia  ', lat: '', lon: '', start: '', end: '' },
    ])

    expect(payload[0].name).toBe('Valencia')
  })

  it('sends an empty coordinate or date as null, not as zero or an empty string', () => {
    // 0,0 is a real place in the Atlantic. An empty lat has to reach the
    // database as null or the globe pins the trip there.
    const payload = toDestinations([
      { key: 'a', name: 'Somewhere', lat: '', lon: '', start: '', end: '' },
    ])

    expect(payload[0]).toEqual({
      name: 'Somewhere',
      lat: null,
      lon: null,
      starts_on: null,
      ends_on: null,
    })
  })

  it('keeps a genuine zero coordinate', () => {
    const payload = toDestinations([
      { key: 'a', name: 'Null Island', lat: '0', lon: '0', start: '', end: '' },
    ])

    expect(payload[0].lat).toBe(0)
    expect(payload[0].lon).toBe(0)
  })

  it('sends a coordinate that is not a number as null rather than NaN', () => {
    const payload = toDestinations([
      { key: 'a', name: 'Valencia', lat: 'abc', lon: '-0.38', start: '', end: '' },
    ])

    expect(payload[0].lat).toBe(null)
    expect(payload[0].lon).toBe(-0.38)
  })

  it('is empty when every row is blank', () => {
    // write_trip leaves the destinations alone on an empty set rather than
    // blanking the trip, so this is safe: it means "I typed nothing".
    expect(toDestinations([blankRow(), blankRow()])).toEqual([])
  })
})
