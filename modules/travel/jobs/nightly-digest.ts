import { db } from '@/core/db'

export type TravelDigest = {
  upcoming: number
  /** The next trip, if there is one. */
  next: { name: string; destination: string; startsOn: string; daysAway: number } | null
  /** Bookings parsed from email and waiting to be accepted. */
  pending: number
  /** Trips whose confirmed spend has passed their budget. */
  overBudget: { name: string; spentCents: number; budgetCents: number }[]
  placesVisited: number
  countries: number
  /**
   * Destinations across the upcoming trips. A trip holding four cities used to
   * be indistinguishable from one holding a single city, and the count is the
   * cheapest place to say otherwise.
   */
  destinations: number
}

export async function nightlyDigest(): Promise<TravelDigest> {
  const { rows: next } = await db().query<{
    name: string
    destination: string
    starts_on: string
    days: number
  }>(
    `select name, destination, starts_on::text, (starts_on - core.today())::int as days
       from travel.trip
      where status in ('planned', 'booked') and starts_on >= core.today()
      order by starts_on
      limit 1`,
  )

  const { rows: counts } = await db().query<{
    upcoming: string
    pending: string
    places: string
    countries: string
    destinations: string
  }>(
    `select
       (select count(*)::text from travel.trip
         where status in ('planned', 'booked')
           and (starts_on is null or starts_on >= core.today())) as upcoming,
       (select count(*)::text from travel.itinerary_item where status = 'pending') as pending,
       (select count(*)::text from travel.place_visited) as places,
       (select count(distinct country)::text from travel.place_visited
         where country <> '') as countries,
       (select count(*)::text from travel.destination d
          join travel.trip t on t.id = d.trip_id
         where t.status in ('planned', 'booked')
           and (t.starts_on is null or t.starts_on >= core.today())) as destinations`,
  )

  // Only confirmed spend counts against a budget. A pending booking is a guess
  // about an email, and putting a trip over budget on a guess is how a number
  // stops being trusted.
  const { rows: over } = await db().query<{
    name: string
    spent: string
    budget: string
  }>(
    `select t.name, sum(i.amount_cents)::text as spent, t.budget_cents::text as budget
       from travel.trip t
       join travel.itinerary_item i on i.trip_id = t.id and i.status = 'confirmed'
      where t.budget_cents > 0 and t.status <> 'done'
      group by t.id, t.name, t.budget_cents
     having sum(i.amount_cents) > t.budget_cents`,
  )

  return {
    upcoming: Number(counts[0].upcoming),
    next: next[0]
      ? {
          name: next[0].name,
          destination: next[0].destination,
          startsOn: next[0].starts_on,
          daysAway: next[0].days,
        }
      : null,
    pending: Number(counts[0].pending),
    overBudget: over.map((o) => ({
      name: o.name,
      spentCents: Number(o.spent),
      budgetCents: Number(o.budget),
    })),
    placesVisited: Number(counts[0].places),
    countries: Number(counts[0].countries),
    destinations: Number(counts[0].destinations),
  }
}

/**
 * Close out a trip whose end date has passed, and record where it went.
 *
 * The place is what outlives the trip: the map is a record of where you have
 * been, and it should not empty out because a trip was archived. Idempotent on
 * (source, external_id), so a second run corrects rather than duplicates.
 */
export async function completeFinishedTrips(): Promise<{ completed: number }> {
  const { rows } = await db().query<{
    id: string
    name: string
    destination: string
    lat: string | null
    lon: string | null
    ends_on: string
  }>(
    `select id, name, destination, lat::text, lon::text, ends_on::text
       from travel.trip
      where status = 'booked' and ends_on is not null and ends_on < core.today()`,
  )

  const { register } = await import('@/core/entities')

  const { listDestinations } = await import('../data')

  for (const trip of rows) {
    await db().query(`update travel.trip set status = 'done' where id = $1`, [trip.id])

    // One place per destination: a trip through four cities visited four
    // places, and a map that shows only the first is wrong about where you
    // have been. Each keeps its own end date, because that is when it was.
    const destinations = (await listDestinations(trip.id)).filter(
      (d) => d.lat !== null && d.lon !== null,
    )

    for (const d of destinations) {
      await db().query(
        `insert into travel.place_visited
           (trip_id, name, lat, lon, visited_on, source, external_id)
         values ($1, $2, $3, $4, $5, 'agent', $6)
         on conflict (source, external_id) do update set visited_on = excluded.visited_on`,
        [trip.id, d.name || trip.name, d.lat, d.lon, d.ends_on ?? trip.ends_on, `dest-${d.id}`],
      )
    }

    // A trip with no destination rows still has its own place, and the
    // trip-<id> external_id it was already filed under stays so a second run
    // corrects rather than duplicates.
    if (destinations.length === 0 && trip.lat !== null && trip.lon !== null) {
      await db().query(
        `insert into travel.place_visited
           (trip_id, name, lat, lon, visited_on, source, external_id)
         values ($1, $2, $3, $4, $5, 'agent', $6)
         on conflict (source, external_id) do update set visited_on = excluded.visited_on`,
        [trip.id, trip.destination || trip.name, trip.lat, trip.lon, trip.ends_on, `trip-${trip.id}`],
      )
    }

    await register({
      module: 'travel',
      entityType: 'trip',
      entityId: trip.id,
      title: trip.name,
      eventType: 'trip_completed',
    })
  }

  return { completed: rows.length }
}
