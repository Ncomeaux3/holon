import { db } from '@/core/db'
import { register } from '@/core/entities'
import type { BodyMetric, Workout } from '@/integrations/health_auto_export/client'

export type InboundSource = 'health_auto_export' | 'apple_shortcuts'

/**
 * What every phone-side Apple Health source writes, once its integration has
 * translated the payload. Readings upsert on (kind, measured_on) and never
 * replace a value the owner typed; workouts upsert on (source, external_id)
 * like Strava's and earn their XP once, on first insert.
 */
export async function writeReadings(
  source: InboundSource,
  metrics: BodyMetric[],
  workouts: Workout[],
): Promise<void> {
  for (const m of metrics) {
    // A push corrects an earlier push for the same day and never touches a
    // value the owner typed: `source = 'manual'` is this table's manual guard,
    // the flag log_metric stamps. No register(), like log_metric.
    await db().query(
      `insert into fitness.body_metric (kind, value, measured_on, source)
       values ($1, $2, $3, $4)
       on conflict (kind, measured_on) do update
         set value = excluded.value, source = excluded.source
         where fitness.body_metric.source <> 'manual'`,
      [m.kind, m.value, m.measuredOn, source],
    )
  }

  for (const w of workouts) {
    const { rows } = await db().query<{ id: string; title: string; started_at: Date; inserted: boolean }>(
      `insert into fitness.workout
         (name, kind, started_at, duration_s, distance_m, avg_hr, detail, source, external_id, stats)
       values ($1, $2, $3::timestamptz, $4, $5, $6, $7, $8, $9, $10)
       on conflict (source, external_id) do update
         set name = excluded.name, kind = excluded.kind, started_at = excluded.started_at,
             duration_s = excluded.duration_s, distance_m = excluded.distance_m,
             avg_hr = excluded.avg_hr, detail = excluded.detail, stats = excluded.stats
       returning id, name as title, started_at, (xmax = 0) as inserted`,
      [w.name, w.kind, w.startedAt, w.durationS, w.distanceM, w.avgHr, w.detail, source, w.externalId, w.stats],
    )
    await register({
      module: 'fitness',
      entityType: 'workout',
      entityId: rows[0].id,
      title: rows[0].title,
      eventType: 'workout_logged',
      // Postgres parsed the app's timestamp; JS Date would not reliably.
      occurredAt: rows[0].started_at,
      // A named event always emits, so a re-send would earn the XP twice.
      // The entity still re-registers, which keeps its title current.
      emit: rows[0].inserted,
    })
  }
}
