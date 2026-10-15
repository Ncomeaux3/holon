// The itinerary's days and the city each one is in. No imports, so the trip
// drawer and the write_item tool share it.

export const KINDS = ['flight', 'lodging', 'transit', 'activity', 'food', 'other'] as const
export type Kind = (typeof KINDS)[number]

/** Every date from the first to the last, inclusive. UTC arithmetic, so a clock change cannot skip a day. */
export function tripDays(startsOn: string | null, endsOn: string | null): string[] {
  if (!startsOn) return []
  const days: string[] = []
  const d = new Date(`${startsOn}T00:00:00Z`)
  const last = endsOn && endsOn > startsOn ? endsOn : startsOn
  for (let iso = startsOn; iso <= last; iso = d.toISOString().slice(0, 10)) {
    days.push(iso)
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return days
}

/**
 * The destinations whose dates cover a day, in the order they are visited.
 * Two on the day you leave one city for the next; none on a day nothing covers.
 */
export function placesFor(
  day: string,
  destinations: { name: string; startsOn: string | null; endsOn: string | null }[],
): string[] {
  return destinations
    .filter((d) => d.startsOn && d.startsOn <= day && (d.endsOn ?? d.startsOn) >= day)
    .map((d) => d.name)
}

/** A flight is a flight whatever you call it; everything else is an activity until you say. */
export function guessKind(title: string): Kind {
  const t = title.toLowerCase()
  if (/flight|\b[a-z]{2}\s?\d{2,4}\b|airport|→/.test(t)) return 'flight'
  if (/hotel|check.?in|airbnb|ryokan|hostel/.test(t)) return 'lodging'
  if (/train|shinkansen|bus|taxi|transfer|metro/.test(t)) return 'transit'
  if (/dinner|lunch|breakfast|restaurant|cafe|coffee/.test(t)) return 'food'
  return 'activity'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Vercel refuses a request body over 4.5 MB; next.config.ts lets an action take 4. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024

/**
 * Where a reservation's file goes in the travel bucket, or why it cannot.
 * The trip id is the folder, so it is checked before it becomes a path. A PDF
 * or a raster image; not SVG, which is a document that can carry script.
 */
export function reservationPath(
  tripId: string,
  file: { name: string; type: string; size: number },
  now = Date.now(),
): string {
  if (!UUID.test(tripId)) throw new Error('No such trip')
  if (file.type !== 'application/pdf' && !(file.type.startsWith('image/') && file.type !== 'image/svg+xml')) {
    throw new Error('Attach a PDF or an image')
  }
  if (file.size > MAX_FILE_BYTES) throw new Error('That file is over 4 MB; attach a smaller copy')
  return `${tripId}/${now}-${file.name.replace(/[^A-Za-z0-9._-]/g, '_')}`
}
