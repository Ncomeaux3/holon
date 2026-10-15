import { db } from '@/core/db'
import { recordError } from '@/core/log'
import { getModule } from '@/core/modules'
import { callTool } from '@/core/tools'

// Trip spend lives in Finance (v1.2 phase 10b). Travel hands it the trip's
// places and dates and Finance's pre-tag rule does the matching; Travel reads
// the result back through the spend seam and never a finance table.

/**
 * Re-run Finance's trip rule for one trip. Each destination with dates is a
 * place; a trip with none uses its own destination over its own span. A
 * template without Finance, or a trip with no dates, tags nothing.
 */
export async function tagTripSpend(tripId: string): Promise<void> {
  if (!getModule('finance')) return
  // After the trip is written: a failed tag is a missing suggestion the
  // nightly pass retries, not a failed save, so it goes to the Errors tab.
  try {
    await tag(tripId)
  } catch (error) {
    await recordError('travel.tag_trip_spend', error)
  }
}

async function tag(tripId: string): Promise<void> {
  const { rows } = await db().query<{ ref: string; destination: string; starts_on: string | null; ends_on: string | null }>(
    `select e.id as ref, t.destination, t.starts_on::text, t.ends_on::text
       from travel.trip t
       join core.entities e on e.module = 'travel' and e.entity_type = 'trip' and e.entity_id = t.id::text
      where t.id = $1`,
    [tripId],
  )
  const trip = rows[0]
  if (!trip) return
  const { rows: stops } = await db().query<{ name: string; from: string; to: string }>(
    `select name, coalesce(starts_on, $2::date)::text as from, coalesce(ends_on, $3::date)::text as to
       from travel.destination where trip_id = $1`,
    [tripId, trip.starts_on, trip.ends_on],
  )
  const places = stops.length > 0
    ? stops.filter((s) => s.from && s.to)
    : trip.starts_on && trip.ends_on && trip.destination
      ? [{ name: trip.destination, from: trip.starts_on, to: trip.ends_on }]
      : []
  // As the owner, not an agent: a deterministic rule like the nightly
  // categorise, and only a suggestion the owner confirms on the row. As an
  // agent it would put every trip save on Review under observe.
  await callTool('finance', 'tag_trip', { trip_ref: trip.ref, places }, { source: 'ui' })
}

const refOf = async (tripId: string): Promise<string | null> =>
  (
    await db().query<{ id: string }>(
      `select id from core.entities where module = 'travel' and entity_type = 'trip' and entity_id = $1`,
      [tripId],
    )
  ).rows[0]?.id ?? null

/**
 * Before a trip's registry row is deleted: its tagged transactions follow it
 * into the trip it merges into, or are freed for the rule when it is deleted.
 * Throws, so a trip whose spend could not move is not deleted.
 */
export async function moveTripSpend(tripId: string, intoTripId: string | null): Promise<void> {
  if (!getModule('finance')) return
  const from = await refOf(tripId)
  if (!from) return
  const to = intoTripId ? await refOf(intoTripId) : null
  await callTool('finance', 'move_trip_tags', { from, to }, { source: 'ui' })
}

/** The nightly pass: every trip with dates that ended in the last 90 days or has not ended. */
export async function tagRecentTrips(): Promise<{ trips: number }> {
  const { rows } = await db().query<{ id: string }>(
    `select id from travel.trip
      where starts_on is not null and ends_on is not null
        and ends_on >= core.today() - 90`,
  )
  for (const r of rows) await tagTripSpend(r.id)
  return { trips: rows.length }
}
