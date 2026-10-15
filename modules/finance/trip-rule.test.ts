import { describe, expect, it } from 'vitest'
import { cityOf, matchesTrip } from './trip-rule'

const ghent = { name: 'Ghent, Belgium', from: '2026-05-11', to: '2026-05-15' }
const prague = { name: 'Prague', from: '2026-05-16', to: '2026-05-19' }

describe('cityOf', () => {
  it('is the part before the comma, normalised', () => {
    expect(cityOf('Ghent, Belgium')).toBe('ghent')
    expect(cityOf('  São Paulo ')).toBe('s o paulo')
  })
})

describe('matchesTrip', () => {
  it('tags a charge in the city on a day the trip is there', () => {
    expect(matchesTrip({ descriptor: 'GRAVENSTEEN CAFE GHENT BE', occurredOn: '2026-05-12' }, [ghent, prague])).toBe(true)
  })

  it('needs the city as a whole word', () => {
    expect(matchesTrip({ descriptor: 'GHENTWEAR ONLINE', occurredOn: '2026-05-12' }, [ghent])).toBe(false)
  })

  it('needs the day inside that destination, not just the trip', () => {
    expect(matchesTrip({ descriptor: 'CAFE GHENT', occurredOn: '2026-05-17' }, [ghent, prague])).toBe(false)
    expect(matchesTrip({ descriptor: 'PRAGUE CASTLE TICKETS', occurredOn: '2026-05-17' }, [ghent, prague])).toBe(true)
  })

  it('includes both end days', () => {
    expect(matchesTrip({ descriptor: 'GHENT STATION', occurredOn: '2026-05-15' }, [ghent])).toBe(true)
    expect(matchesTrip({ descriptor: 'GHENT STATION', occurredOn: '2026-05-10' }, [ghent])).toBe(false)
  })
})
