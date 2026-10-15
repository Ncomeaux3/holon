// What the globe draws, as data.
//
// Same reason as rows.ts: the screen is React and cannot be asserted on from
// here, so which trips become pins, where each pin sits and what it opens are
// decided in this file and tested. What is left in the component is the markup.

import type { Pin, PinKind } from './Globe'

type TripLike = {
  id: string
  name: string
  destination: string
  lat: number | null
  lon: number | null
}

type DestinationLike = {
  id: string
  tripId: string
  name: string
  lat: number | null
  lon: number | null
}

type PlaceLike = {
  id: string
  tripId: string | null
  name: string
  country: string
  lat: number
  lon: number
}

/**
 * A trip's pins.
 *
 * One pin per destination, because a trip through four cities is four places on
 * the globe and drawing only the first was the whole reason destinations exist.
 * A trip with no destination rows falls back to its own coordinates, which is
 * every trip written through write_trip without a set. A trip with neither
 * draws nothing.
 *
 * The id carries the trip, and the destination after a colon when there is one,
 * so a pin still opens its trip. It used to carry the destination id alone,
 * which matches no trip and opened nothing.
 */
function tripPins(
  trips: TripLike[],
  destinations: DestinationLike[],
  kind: PinKind,
  prefix: string,
): Pin[] {
  return trips.flatMap((t) => {
    const placed = destinations.filter((d) => d.tripId === t.id && d.lat !== null && d.lon !== null)
    if (placed.length > 0) {
      return placed.map((d) => ({
        id: `${prefix}-${t.id}:${d.id}`,
        name: d.name || t.name,
        country: '',
        lat: d.lat!,
        lon: d.lon!,
        kind,
      }))
    }
    if (t.lat === null || t.lon === null) return []
    return [{ id: `${prefix}-${t.id}`, name: t.destination || t.name, country: '', lat: t.lat, lon: t.lon, kind }]
  })
}

/**
 * Every pin on the globe: upcoming trips in the accent with a label, places
 * visited in grey, wishes as dashed rings.
 *
 * A past trip pins itself in grey too. The nightly job writes one
 * `place_visited` per destination when a booked trip ends, but a trip marked
 * done by hand, or one left planned past its end date, never reaches that job,
 * so the trip was in the Past list and nowhere on the globe. A past trip whose
 * places are already recorded is left to them, so a completed trip pins once.
 */
export function pinsFor(input: {
  upcoming: TripLike[]
  past: TripLike[]
  wishlist: TripLike[]
  destinations: DestinationLike[]
  places: PlaceLike[]
}): Pin[] {
  const recorded = new Set(
    input.places.map((p) => p.tripId).filter((id): id is string => id !== null),
  )
  return [
    ...tripPins(input.upcoming, input.destinations, 'upcoming', 'trip'),
    ...input.places.map((p) => ({
      id: `place-${p.id}`,
      name: p.name,
      country: p.country,
      lat: p.lat,
      lon: p.lon,
      kind: 'past' as const,
    })),
    ...tripPins(
      input.past.filter((t) => !recorded.has(t.id)),
      input.destinations,
      'past',
      'past',
    ),
    ...tripPins(input.wishlist, input.destinations, 'wishlist', 'wish'),
  ]
}

/**
 * What a pin opens: a trip, a visited place, or nothing.
 *
 * A visited place opens the trip it was part of; one with no trip, or whose
 * trip is gone, opens as itself.
 */
export function pinTarget(
  id: string,
  places: PlaceLike[],
  hasTrip: (id: string) => boolean,
): { trip: string } | { place: string } | null {
  // Every trip prefix is five characters, the dash included, and the
  // destination follows a colon when there is one.
  const place = id.startsWith('place-') ? places.find((p) => p.id === id.slice(6)) : undefined
  const trip = place
    ? place.tripId
    : /^(trip|past|wish)-/.test(id)
      ? id.slice(5).split(':')[0]
      : null
  if (trip && hasTrip(trip)) return { trip }
  if (place) return { place: place.id }
  return null
}
