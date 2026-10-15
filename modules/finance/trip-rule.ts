import { normalise } from './categorise'

// The pre-tag rule for trip spend: a charge dated while a trip is in a city,
// whose descriptor names that city, is probably the trip's. Rules only and no
// model call; the owner confirms or clears it on the transaction row.

/** One stop: its name as typed and the days it covers, both YYYY-MM-DD. */
export type Place = { name: string; from: string; to: string }

/** "Ghent, Belgium" is matched on "ghent": a bank descriptor carries the city, rarely the country. */
export function cityOf(name: string): string {
  return normalise(name.split(',')[0])
}

export function matchesTrip(row: { descriptor: string; occurredOn: string }, places: Place[]): boolean {
  const text = ` ${normalise(row.descriptor)} `
  return places.some((p) => {
    const city = cityOf(p.name)
    return city !== '' && row.occurredOn >= p.from && row.occurredOn <= p.to && text.includes(` ${city} `)
  })
}
