import { db } from '@/core/db'

// Reads for the screen and the digest. The projection and the cents per point
// arithmetic live in ./globe.ts, which has no imports and can be pulled into a
// client component.

export type TripRow = {
  id: string
  name: string
  destination: string
  lat: string | null
  lon: string | null
  starts_on: string | null
  ends_on: string | null
  budget_cents: string
  travellers: number
  status: string
  notes: string
  planned_cents: string
  item_count: string
  pending_count: string
  packed: string
  to_pack: string
}

/**
 * Every trip with what it has planned so far and how the packing is going.
 * What it actually cost is Finance's, read through the spend seam on the page.
 *
 * Planned is summed from the confirmed itinerary rather than stored on the trip: a booking
 * cancelled is a row removed, and a denormalised total would have to be kept
 * honest by something. Nothing here is big enough for that to be slow.
 */
export async function listTrips(): Promise<TripRow[]> {
  const { rows } = await db().query<TripRow>(
    `select t.id, t.name, t.destination, t.lat::text, t.lon::text,
            t.starts_on::text, t.ends_on::text, t.budget_cents::text,
            t.travellers, t.status, t.notes,
            coalesce(sum(i.amount_cents) filter (where i.status = 'confirmed'), 0)::text
              as planned_cents,
            count(i.id) filter (where i.status = 'confirmed')::text as item_count,
            count(i.id) filter (where i.status = 'pending')::text as pending_count,
            (select count(*)::text from travel.packing_item p
              where p.trip_id = t.id and p.packed) as packed,
            (select count(*)::text from travel.packing_item p where p.trip_id = t.id) as to_pack
       from travel.trip t
       left join travel.itinerary_item i on i.trip_id = t.id
      group by t.id
      order by
        -- Upcoming first, then ideas, then what is over. A past trip is a
        -- record; an upcoming one is a thing you still have to do.
        case t.status when 'booked' then 0 when 'planned' then 1
                      when 'idea' then 2 else 3 end,
        t.starts_on nulls last`,
  )
  return rows
}

export type ItineraryRow = {
  id: string
  trip_id: string
  kind: string
  title: string
  detail: string
  occurs_on: string | null
  occurs_at: string | null
  amount_cents: string
  confirmation: string
  status: string
  confidence: string | null
  place: string
  provider: string
  has_file: boolean
}

export async function listItinerary(tripId?: string): Promise<ItineraryRow[]> {
  const { rows } = await db().query<ItineraryRow>(
    `select id, trip_id, kind, title, detail, occurs_on::text, occurs_at::text,
            amount_cents::text, confirmation, status, confidence::text,
            place, provider, file_path is not null as has_file
       from travel.itinerary_item
      where ($1::uuid is null or trip_id = $1)
      order by occurs_on nulls last, occurs_at nulls last`,
    [tripId ?? null],
  )
  return rows
}

export async function listPacking(tripId?: string): Promise<
  { id: string; trip_id: string; label: string; packed: boolean }[]
> {
  const { rows } = await db().query<{
    id: string
    trip_id: string
    label: string
    packed: boolean
  }>(
    `select id, trip_id, label, packed from travel.packing_item
      where ($1::uuid is null or trip_id = $1)
      order by packed, position, label`,
    [tripId ?? null],
  )
  return rows
}

export type PlaceRow = {
  id: string
  trip_id: string | null
  name: string
  country: string
  lat: string
  lon: string
  visited_on: string | null
}

export async function listPlaces(): Promise<PlaceRow[]> {
  const { rows } = await db().query<PlaceRow>(
    `select id, trip_id, name, country, lat::text, lon::text, visited_on::text
       from travel.place_visited order by visited_on desc nulls last`,
  )
  return rows
}

export async function listLoyalty(): Promise<
  {
    id: string
    name: string
    kind: string
    balance: number
    previous_balance: number | null
    status_tier: string
    updated_at: Date
    account_ref: string | null
  }[]
> {
  const { rows } = await db().query<{
    id: string
    name: string
    kind: string
    balance: number
    previous_balance: number | null
    status_tier: string
    updated_at: Date
    account_ref: string | null
  }>(
    `select id, name, kind, balance, previous_balance, status_tier, updated_at, account_ref
       from travel.loyalty_program order by kind, name`,
  )
  return rows
}

/**
 * The Finance accounts a loyalty program can name as the card that earns it,
 * from the registry: Travel reads no finance table, so a title is all it has.
 */
export async function listAccountOptions(): Promise<{ ref: string; title: string }[]> {
  const { rows } = await db().query<{ ref: string; title: string }>(
    `select id as ref, title from core.entities
      where module = 'finance' and entity_type = 'account'
      order by title`,
  )
  return rows
}

export type BudgetLineRow = {
  id: string
  trip_id: string
  category: string
  planned_cents: number
  actual_override_cents: number | null
  position: number
}

export async function listBudgetLines(tripId?: string): Promise<BudgetLineRow[]> {
  const { rows } = await db().query<BudgetLineRow>(
    `select id, trip_id, category, planned_cents::bigint::int as planned_cents,
            actual_override_cents::bigint::int as actual_override_cents, position
       from travel.budget_line
      ${tripId ? 'where trip_id = $1' : ''}
      order by trip_id, position`,
    tripId ? [tripId] : [],
  )
  return rows
}

export type DestinationRow = {
  id: string
  trip_id: string
  name: string
  lat: number | null
  lon: number | null
  starts_on: string | null
  ends_on: string | null
  position: number
}

/**
 * A trip's cities, in the owner's order.
 *
 * Numeric, not text, because the globe projects these and the trip columns
 * they summarise are read the same way. pg returns numeric as a string, so the
 * cast happens once here rather than at every pin.
 */
export async function listDestinations(tripId?: string): Promise<DestinationRow[]> {
  const { rows } = await db().query<Omit<DestinationRow, 'lat' | 'lon'> & {
    lat: string | null
    lon: string | null
  }>(
    `select id, trip_id, name, lat::text, lon::text,
            starts_on::text, ends_on::text, position
       from travel.destination
      ${tripId ? 'where trip_id = $1' : ''}
      order by trip_id, position`,
    tripId ? [tripId] : [],
  )
  return rows.map((r) => ({
    ...r,
    lat: r.lat === null ? null : Number(r.lat),
    lon: r.lon === null ? null : Number(r.lon),
  }))
}
