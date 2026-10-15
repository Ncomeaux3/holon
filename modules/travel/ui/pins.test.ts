import { describe, expect, it } from 'vitest'
import { pinsFor, pinTarget } from './pins'

const trip = (id: string, over: Partial<Parameters<typeof pinsFor>[0]['past'][number]> = {}) => ({
  id,
  name: `Trip ${id}`,
  destination: '',
  lat: 10,
  lon: 20,
  ...over,
})

const destination = (id: string, tripId: string, over: Record<string, unknown> = {}) => ({
  id,
  tripId,
  name: `Stop ${id}`,
  lat: 1,
  lon: 2,
  ...over,
})

const place = (id: string, tripId: string | null = null) => ({
  id,
  tripId,
  name: `Place ${id}`,
  country: 'Portugal',
  lat: 38.72,
  lon: -9.14,
})

const empty = { upcoming: [], past: [], wishlist: [], destinations: [], places: [] }

describe('pinsFor', () => {
  it('pins a past trip in grey, the bug: only places visited were drawn', () => {
    const pins = pinsFor({ ...empty, past: [trip('a', { destination: 'Portland' })] })
    expect(pins).toEqual([
      { id: 'past-a', name: 'Portland', country: '', lat: 10, lon: 20, kind: 'past' },
    ])
  })

  it('leaves a past trip to its places once the nightly has recorded them', () => {
    const pins = pinsFor({ ...empty, past: [trip('a')], places: [place('p1', 'a')] })
    expect(pins.map((p) => p.id)).toEqual(['place-p1'])
  })

  it('still pins a past trip when a place belongs to a different trip', () => {
    const pins = pinsFor({ ...empty, past: [trip('a')], places: [place('p1', 'b')] })
    expect(pins.map((p) => p.id)).toEqual(['place-p1', 'past-a'])
  })

  it('pins every destination that has coordinates, not just the first', () => {
    const pins = pinsFor({
      ...empty,
      past: [trip('a')],
      destinations: [
        destination('d1', 'a'),
        destination('d2', 'a', { lat: 3, lon: 4 }),
        destination('d3', 'a', { lat: null }),
        destination('d4', 'other'),
      ],
    })
    expect(pins.map((p) => p.id)).toEqual(['past-a:d1', 'past-a:d2'])
    expect(pins.map((p) => p.kind)).toEqual(['past', 'past'])
  })

  it('draws nothing for a trip with no coordinates anywhere', () => {
    expect(pinsFor({ ...empty, past: [trip('a', { lat: null, lon: null })] })).toEqual([])
  })

  it('keeps each list in its own colour', () => {
    const pins = pinsFor({
      ...empty,
      upcoming: [trip('u')],
      past: [trip('p')],
      wishlist: [trip('w')],
      places: [place('v')],
    })
    expect(pins.map((p) => [p.id, p.kind])).toEqual([
      ['trip-u', 'upcoming'],
      ['place-v', 'past'],
      ['past-p', 'past'],
      ['wish-w', 'wishlist'],
    ])
  })
})

describe('pinTarget', () => {
  const has = (id: string) => id === 'a'

  it('opens the trip behind a destination pin, which used to open nothing', () => {
    expect(pinTarget('trip-a:d1', [], has)).toEqual({ trip: 'a' })
    expect(pinTarget('past-a:d1', [], has)).toEqual({ trip: 'a' })
  })

  it('opens the trip behind a trip, past or wish pin', () => {
    expect(pinTarget('trip-a', [], has)).toEqual({ trip: 'a' })
    expect(pinTarget('past-a', [], has)).toEqual({ trip: 'a' })
    expect(pinTarget('wish-a', [], has)).toEqual({ trip: 'a' })
  })

  it('opens the trip a visited place belongs to', () => {
    expect(pinTarget('place-p1', [place('p1', 'a')], has)).toEqual({ trip: 'a' })
  })

  it('opens a place as itself when it has no trip, or its trip is gone', () => {
    expect(pinTarget('place-p1', [place('p1')], has)).toEqual({ place: 'p1' })
    expect(pinTarget('place-p1', [place('p1', 'gone')], has)).toEqual({ place: 'p1' })
  })

  it('opens nothing for a pin that names no trip of ours', () => {
    expect(pinTarget('trip-gone', [], has)).toBeNull()
    expect(pinTarget('place-gone', [], has)).toBeNull()
  })
})
