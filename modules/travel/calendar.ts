import { db } from '@/core/db'
import type { CalendarItem } from '@/core/module-contract'

// What Travel puts on the Calendar: one all-day item per day of a trip, and
// the itinerary items booked inside it. Neither table has a cancelled state
// to exclude: a trip is idea, planned, booked or done, and an itinerary item
// is pending or confirmed, so nothing here is filtered on status.

export type TripRow = {
  id: string
  name: string
  starts_on: string | null
  ends_on: string | null
}

const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000
const addDays = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/** One all-day item per day of a trip that falls inside the range. */
export function tripDayItems(trips: TripRow[], range: { from: string; to: string }): CalendarItem[] {
  const items: CalendarItem[] = []

  for (const t of trips) {
    if (!t.starts_on) continue
    const end = t.ends_on ?? t.starts_on
    const total = dayOf(end) - dayOf(t.starts_on) + 1

    for (let n = 0; n < total; n++) {
      const date = addDays(t.starts_on, n)
      if (date < range.from || date > range.to) continue
      items.push({
        id: `${t.id}:${date}`,
        module: 'travel',
        title: total > 1 ? `${t.name}, day ${n + 1} of ${total}` : t.name,
        startsAt: date,
        allDay: true,
        href: `/travel?trip=${t.id}`,
        kind: 'trip',
      })
    }
  }

  return items
}

export type ItineraryRow = {
  id: string
  trip_id: string
  title: string
  occurs_on: string | null
  /** 'HH:MM', or null for an item with no time of day. */
  occurs_at: string | null
}

export function itineraryItems(
  rows: ItineraryRow[],
  range: { from: string; to: string },
): CalendarItem[] {
  return rows
    .filter((r): r is ItineraryRow & { occurs_on: string } =>
      r.occurs_on !== null && r.occurs_on >= range.from && r.occurs_on <= range.to,
    )
    .map((r) => ({
      id: r.id,
      module: 'travel',
      title: r.title,
      startsAt: r.occurs_at ? `${r.occurs_on}T${r.occurs_at}` : r.occurs_on,
      allDay: r.occurs_at === null,
      href: `/travel?trip=${r.trip_id}`,
      kind: 'itinerary',
    }))
}

export async function calendarFor(range: { from: string; to: string }): Promise<CalendarItem[]> {
  const [{ rows: trips }, { rows: items }] = await Promise.all([
    db().query<TripRow>(
      `select id, name, starts_on::text, ends_on::text
         from travel.trip
        where starts_on is not null
          and starts_on <= $2
          and coalesce(ends_on, starts_on) >= $1`,
      [range.from, range.to],
    ),
    db().query<ItineraryRow>(
      `select id, trip_id, title, occurs_on::text, to_char(occurs_at, 'HH24:MI') as occurs_at
         from travel.itinerary_item
        where occurs_on between $1 and $2`,
      [range.from, range.to],
    ),
  ])

  return [...tripDayItems(trips, range), ...itineraryItems(items, range)]
}
