// A trip's own place and dates are a summary of its destinations.
//
// travel.destination arrived after every reader in this module was already
// reading trip.destination, trip.lat, trip.lon, trip.starts_on and
// trip.ends_on. Rather than teach each of them about a second table, those
// columns stay and are kept true: the place is the first destination's, the
// span covers all of them. The tile, the digest, the list and
// completeFinishedTrips carry on untouched.

export type Destination = {
  name: string
  lat: number | null
  lon: number | null
  starts_on: string | null
  ends_on: string | null
}

export type TripSummary = {
  destination: string
  lat: number | null
  lon: number | null
  starts_on: string | null
  ends_on: string | null
}

/** The smallest of the dates that exist, or null when none do. */
function edge(dates: (string | null)[], pick: 'min' | 'max'): string | null {
  // ISO dates sort lexicographically, which is the whole reason this app
  // stores and passes them as strings rather than parsing to compare.
  const known = dates.filter((d): d is string => d !== null).sort()
  if (known.length === 0) return null
  return pick === 'min' ? known[0] : known[known.length - 1]
}

/**
 * The trip columns for a set of destinations, in the owner's order.
 *
 * The place comes from the first destination, whatever that row knows: a trip
 * whose first city has not been geocoded has not been geocoded, and reaching
 * past it to a later row would pin the trip somewhere the owner did not put
 * first. A trip with no destinations at all keeps its own lat and lon, which
 * is handled by the caller rather than here, because this returns the summary
 * and not the merge.
 *
 * The span is the earliest start and the latest end across every destination
 * that has one. Not the first and last rows: position is the order the owner
 * put them in, and a flight home booked early still sits where they put it.
 */
export function summarise(destinations: Destination[]): TripSummary {
  const first = destinations[0]

  return {
    destination: first?.name ?? '',
    lat: first?.lat ?? null,
    lon: first?.lon ?? null,
    starts_on: edge(destinations.map((d) => d.starts_on), 'min'),
    ends_on: edge(destinations.map((d) => d.ends_on), 'max'),
  }
}
