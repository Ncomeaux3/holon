import { db } from '@/core/db'
import { register } from '@/core/entities'
import { getCredentials } from '@/core/credentials'
import { activities, toKind, type Activity } from '@/integrations/strava/client'

// Pull workouts from Strava. Runs nightly, before the digest, so the numbers
// the digest reports include last night's ride.
//
// Strava is the source of truth for anything it knows about: a workout it sent
// is re-upserted on `(source, external_id)`, so re-running the sync corrects a
// renamed activity rather than duplicating it. Nothing here touches a workout
// the owner typed by hand, because those carry source 'manual' and a different
// unique key.

export type SyncResult = {
  /** Skipped entirely, because Strava is not connected. */
  skipped: boolean
  fetched: number
  written: number
  detail: string
}

/**
 * How far back a run with nothing stored asks for.
 *
 * A year rather than everything: the first sync should open the module with
 * real history, not spend twenty paginated calls importing a decade. Anything
 * older is a backfill, which is a different job nobody has asked for.
 */
const FIRST_RUN_DAYS = 365

/** An overlap, so an activity uploaded late is not missed between two runs. */
const OVERLAP_HOURS = 48

async function since(): Promise<Date> {
  const { rows } = await db().query<{ latest: Date | null }>(
    `select max(started_at) as latest from fitness.workout where source = 'strava'`,
  )
  const latest = rows[0]?.latest
  if (!latest) return new Date(Date.now() - FIRST_RUN_DAYS * 86_400_000)
  return new Date(new Date(latest).getTime() - OVERLAP_HOURS * 3_600_000)
}

export async function store(a: Activity): Promise<void> {
  // Strava sends metres and seconds as floats. The column is integer metres on
  // purpose, so round here rather than letting Postgres truncate silently.
  const { rows } = await db().query<{ id: string; title: string; inserted: boolean }>(
    `insert into fitness.workout
       (name, kind, started_at, duration_s, distance_m, avg_hr, source, external_id)
     values ($1, $2, $3, $4, $5, $6, 'strava', $7)
     on conflict (source, external_id) do update
       set name = excluded.name,
           kind = excluded.kind,
           started_at = excluded.started_at,
           duration_s = excluded.duration_s,
           distance_m = excluded.distance_m,
           avg_hr = excluded.avg_hr,
           updated_at = now()
     returning id, name as title, (xmax = 0) as inserted`,
    [
      a.name,
      toKind(a.sport_type),
      a.start_date,
      Math.round(a.moving_time),
      Math.round(a.distance * 100) / 100,
      // Out of range readings exist and the column has a check constraint, so
      // a bad strap reading stores as no reading rather than failing the run.
      a.average_heartrate && a.average_heartrate >= 20 && a.average_heartrate <= 260
        ? Math.round(a.average_heartrate)
        : null,
      String(a.id),
    ],
  )

  // register() emits workout_logged, which is what earns Health XP and moves a
  // fitness goal. It backdates to the activity, not to tonight's job run. A
  // named event always emits, and the 48 hour overlap stores most activities
  // on two or three runs, so the event is tied to the insert: the entity
  // still re-registers, which keeps a renamed activity's title current.
  await register({
    module: 'fitness',
    entityType: 'workout',
    entityId: rows[0].id,
    title: rows[0].title,
    eventType: 'workout_logged',
    occurredAt: new Date(a.start_date),
    emit: rows[0].inserted,
  })
}

/**
 * Never throws. A provider that is down must leave the rest of the nightly run
 * alone, and the job runner records the outcome either way.
 */
export async function syncStrava(): Promise<SyncResult> {
  if (!(await getCredentials('strava'))?.access_token) {
    return { skipped: true, fetched: 0, written: 0, detail: 'Strava is not connected.' }
  }

  const from = await since()
  const found = await activities(from)

  let written = 0
  for (const a of found) {
    await store(a)
    written++
  }

  return {
    skipped: false,
    fetched: found.length,
    written,
    detail: `${written} workouts since ${from.toISOString().slice(0, 10)}.`,
  }
}
