import { db } from '@/core/db'
import { register } from '@/core/entities'

// Synthetic rows for `pnpm setup --demo`. Upserts on external_id so running it
// twice does not duplicate. Nothing here is personal; this ships in the template.
//
// Coordinates are real so the globe shows a real spread. The places are chosen
// across four continents, because a globe whose dots all sit in one hemisphere
// does not show that it spins.

const TRIPS = [
  {
    external_id: 'trip-taipei',
    name: 'Taipei, November',
    destination: 'Taipei',
    lat: 25.03,
    lon: 121.57,
    startsIn: 54,
    days: 9,
    budget: 420_000,
    travellers: 2,
    status: 'booked' as const,
    items: [
      { kind: 'flight' as const, title: 'RDU to TPE', detail: 'Seat 38H', day: 0, at: '10:20', cents: 128_000, status: 'confirmed' as const },
      { kind: 'lodging' as const, title: 'Check in, Xinyi', detail: '8 nights', day: 1, at: '15:00', cents: 112_000, status: 'confirmed' as const },
      { kind: 'activity' as const, title: 'Night market walk', detail: 'Guided, 3h', day: 2, at: '18:00', cents: 9_500, status: 'confirmed' as const },
      { kind: 'transit' as const, title: 'Train to Tainan', detail: 'Reserved car 5', day: 4, at: '08:40', cents: 0, status: 'confirmed' as const },
      // Two parsed from booking emails, waiting in the inbox. This is the whole
      // reason the inbox tab has anything in it.
      { kind: 'lodging' as const, title: 'Check in, Tainan', detail: '2 nights, prepaid', day: 4, at: '15:00', cents: 46_000, status: 'pending' as const, confidence: 0.94 },
      { kind: 'activity' as const, title: 'Museum tickets, 2', detail: 'E-tickets attached', day: 3, at: '14:00', cents: 3_200, status: 'pending' as const, confidence: 0.88 },
    ],
    packing: ['Passport', 'Rail pass', 'Rain shell', 'Layers', 'Walking shoes', 'Power adapter'],
    lines: [['Flights', 1400], ['Lodging', 1250], ['Food', 800], ['Transit', 300], ['Activities', 450]],
  },
  {
    external_id: 'trip-saltlake',
    name: 'Salt Lake City, ski weekend',
    destination: 'Salt Lake City',
    lat: 40.76,
    lon: -111.89,
    startsIn: 131,
    days: 4,
    budget: 210_000,
    travellers: 4,
    status: 'planned' as const,
    items: [
      { kind: 'flight' as const, title: 'RDU to SLC', detail: 'Group of 4', day: 0, at: '07:40', cents: 52_400, status: 'confirmed' as const },
    ],
    packing: ['Ski pants', 'Goggles', 'Base layers', 'Season pass'],
    lines: [['Flights', 600], ['Lodging', 950], ['Food', 300], ['Transit', 150], ['Activities', 100]],
  },
  {
    external_id: 'trip-queenstown',
    name: 'Queenstown, someday',
    destination: 'Queenstown',
    lat: -45.03,
    lon: 168.66,
    startsIn: null,
    days: 0,
    budget: 0,
    travellers: 2,
    status: 'idea' as const,
    items: [],
    packing: [],
    lines: [],
  },
]

/** Where the demo owner has been. Four continents, so the globe is worth spinning. */
const PLACES = [
  { external_id: 'place-marrakesh', name: 'Marrakesh', country: 'Morocco', lat: 31.63, lon: -7.99, daysAgo: 310 },
  { external_id: 'place-oaxaca', name: 'Oaxaca', country: 'Mexico', lat: 17.07, lon: -96.72, daysAgo: 560 },
  { external_id: 'place-neworleans', name: 'New Orleans', country: 'United States', lat: 29.95, lon: -90.07, daysAgo: 118 },
  { external_id: 'place-hanoi', name: 'Hanoi', country: 'Vietnam', lat: 21.03, lon: 105.85, daysAgo: 680 },
  { external_id: 'place-buenosaires', name: 'Buenos Aires', country: 'Argentina', lat: -34.6, lon: -58.38, daysAgo: 940 },
  { external_id: 'place-montreal', name: 'Montreal', country: 'Canada', lat: 45.5, lon: -73.57, daysAgo: 1150 },
]

const LOYALTY = [
  { name: 'Airline A miles', kind: 'airline' as const, balance: 62_400, tier: 'Silver' },
  { name: 'Airline B miles', kind: 'airline' as const, balance: 18_900, tier: '' },
  { name: 'Hotel points', kind: 'hotel' as const, balance: 104_000, tier: 'Gold' },
  { name: 'Card points', kind: 'card' as const, balance: 71_300, tier: '' },
]

export async function seed(): Promise<number> {
  for (const trip of TRIPS) {
    const { rows } = await db().query<{ id: string }>(
      `insert into travel.trip
         (name, destination, lat, lon, starts_on, ends_on, budget_cents, travellers,
          status, source, external_id)
       values ($1, $2, $3, $4,
               case when $5::int is null then null else core.today() + $5::int end,
               case when $5::int is null then null else core.today() + $5::int + $6::int end,
               $7, $8, $9, 'demo', $10)
       on conflict (source, external_id) do update
         set name = excluded.name, status = excluded.status,
             starts_on = excluded.starts_on, ends_on = excluded.ends_on
       returning id`,
      [
        trip.name,
        trip.destination,
        trip.lat,
        trip.lon,
        trip.startsIn,
        trip.days,
        trip.budget,
        trip.travellers,
        trip.status,
        trip.external_id,
      ],
    )
    const tripId = rows[0].id

    for (const [i, item] of trip.items.entries()) {
      await db().query(
        `insert into travel.itinerary_item
           (trip_id, kind, title, detail, occurs_on, occurs_at, amount_cents,
            status, confidence, source, external_id)
         values ($1, $2, $3, $4, core.today() + $5::int, $6, $7, $8, $9, 'demo', $10)
         on conflict (source, external_id) do update
           set status = excluded.status, amount_cents = excluded.amount_cents`,
        [
          tripId,
          item.kind,
          item.title,
          item.detail,
          (trip.startsIn ?? 0) + item.day,
          item.at,
          item.cents,
          item.status,
          'confidence' in item ? item.confidence : null,
          `${trip.external_id}-item-${i}`,
        ],
      )
    }

    // Packing has no external_id, so it is cleared and rewritten. It is a
    // checklist, not a record, and nothing outside the trip points at a row.
    await db().query(`delete from travel.packing_item where trip_id = $1`, [tripId])
    for (const [i, label] of trip.packing.entries()) {
      await db().query(
        `insert into travel.packing_item (trip_id, label, packed, position)
         values ($1, $2, $3, $4)`,
        [tripId, label, i < 2, i],
      )
    }

    // Budget lines, planned per category, as the drawer's Budget tab has them.
    // Upserted on (trip, category) so a re-seed keeps an edited planned figure.
    for (const [i, [category, dollars]] of (trip.lines as [string, number][]).entries()) {
      await db().query(
        `insert into travel.budget_line (trip_id, category, planned_cents, position)
         values ($1, $2, $3, $4)
         on conflict (trip_id, category) do nothing`,
        [tripId, category, dollars * 100, i],
      )
    }

    await register({
      module: 'travel',
      entityType: 'trip',
      entityId: tripId,
      title: trip.name,
      text: trip.destination,
    })
  }

  for (const place of PLACES) {
    await db().query(
      `insert into travel.place_visited
         (name, country, lat, lon, visited_on, source, external_id)
       values ($1, $2, $3, $4, core.today() - $5::int, 'demo', $6)
       on conflict (source, external_id) do update set visited_on = excluded.visited_on`,
      [place.name, place.country, place.lat, place.lon, place.daysAgo, place.external_id],
    )
  }

  for (const program of LOYALTY) {
    await db().query(
      `insert into travel.loyalty_program (name, kind, balance, status_tier)
       values ($1, $2, $3, $4)
       on conflict (name) do update set balance = excluded.balance`,
      [program.name, program.kind, program.balance, program.tier],
    )
  }

  return TRIPS.length + PLACES.length
}
