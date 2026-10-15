// The trip form's destination list, as data.
//
// The form itself is React and cannot be asserted on from here, so everything
// that can be decided without a DOM is decided in this file and tested: what
// the list starts as, and what it becomes on the way to write_trip. What is
// left in the component is the markup and the typing.

/** One row of the list. Strings throughout, because inputs hold strings. */
export type Row = {
  /** React's key. Not the destination id: a new row has no id yet. */
  key: string
  name: string
  lat: string
  lon: string
  start: string
  end: string
}

type TripLike = {
  destination: string
  lat: number | null
  lon: number | null
  startsOn: string | null
  endsOn: string | null
}

type DestinationLike = {
  id: string
  tripId: string
  name: string
  lat: number | null
  lon: number | null
  startsOn: string | null
  endsOn: string | null
  position: number
}

let counter = 0

/** An empty row, with a key nothing else will have. */
export function blankRow(): Row {
  counter += 1
  return { key: `new-${counter}`, name: '', lat: '', lon: '', start: '', end: '' }
}

const text = (value: number | string | null): string => (value === null ? '' : String(value))

/**
 * The list a form opens on.
 *
 * Three cases. A trip with destinations shows them in position order. A trip
 * without them shows its own place, because every trip written through
 * write_trip with no set has one there and an empty row would wipe it on save.
 * Anything else, including a new trip, shows one empty row: a form with
 * nowhere to type has nowhere to start.
 */
export function rowsFor(trip: TripLike | null, destinations: DestinationLike[]): Row[] {
  const mine = [...destinations].sort((a, b) => a.position - b.position)

  if (mine.length > 0) {
    return mine.map((d) => ({
      key: d.id,
      name: d.name,
      lat: text(d.lat),
      lon: text(d.lon),
      start: d.startsOn ?? '',
      end: d.endsOn ?? '',
    }))
  }

  if (trip && (trip.destination !== '' || trip.lat !== null)) {
    return [
      {
        key: 'own',
        name: trip.destination,
        lat: text(trip.lat),
        lon: text(trip.lon),
        start: trip.startsOn ?? '',
        end: trip.endsOn ?? '',
      },
    ]
  }

  return [blankRow()]
}

/** An empty field is null, and a field that is not a number is null too. */
function num(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  // 0,0 is a real place in the Atlantic, so a genuine zero is kept and only an
  // unparseable value is dropped. NaN must never reach the database.
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The rows as write_trip wants them.
 *
 * Rows with no name are dropped rather than rejected: the form always shows at
 * least one row and the plus adds more, so an untouched row is the normal case
 * and not something to report. An entirely blank list comes back empty, which
 * write_trip reads as "leave the destinations alone" rather than as "remove
 * them all".
 */
export function toDestinations(rows: Row[]): {
  name: string
  lat: number | null
  lon: number | null
  starts_on: string | null
  ends_on: string | null
}[] {
  return rows
    .filter((r) => r.name.trim() !== '')
    .map((r) => ({
      name: r.name.trim(),
      lat: num(r.lat),
      lon: num(r.lon),
      starts_on: r.start || null,
      ends_on: r.end || null,
    }))
}
