// The translation from what an iOS Shortcut posts to the rows the Fitness
// module stores. Pure and import free bar the row types, so a test can feed
// it a payload without a database.
//
// The shape is this app's own, flat so a Shortcut can build it with one
// Dictionary action: { day, metrics: { key: number }, workouts: [...] }. Every
// key is optional; a Shortcut that only reads weight sends one key. Numbers
// may arrive as strings, which is how Shortcuts hands them over, and a metric
// the phone has no sample for arrives blank. The recipe for the Shortcut is
// in docs/SETUP-INTEGRATIONS.md.

import type { BodyMetric, BodyMetricKind, Workout, WorkoutKind } from '@/integrations/health_auto_export/client'

const GRAMS_PER_LB = 453.59237
const METRES_PER_MI = 1609.344

/** Metric key to kind and the scale from the key's unit to the stored one. */
const METRICS: Record<string, [BodyMetricKind, (v: number) => number]> = {
  weight_lb: ['weight', (v) => v * GRAMS_PER_LB],
  weight_kg: ['weight', (v) => v * 1000],
  resting_hr: ['resting_hr', (v) => v],
  hrv_ms: ['hrv', (v) => v],
  body_fat_pct: ['body_fat', (v) => v * 10],
  sleep_hours: ['sleep_minutes', (v) => v * 60],
  steps: ['steps', (v) => v],
  active_kcal: ['active_energy', (v) => v],
  exercise_min: ['exercise_minutes', (v) => v],
  stand_hours: ['stand_hours', (v) => v],
  vo2_max: ['vo2_max', (v) => v * 10],
  spo2_pct: ['blood_oxygen', (v) => v * 10],
  resp_rate: ['respiratory_rate', (v) => v * 10],
  flights: ['flights_climbed', (v) => v],
  walk_mi: ['walking_distance', (v) => v * METRES_PER_MI],
  walk_km: ['walking_distance', (v) => v * 1000],
  walking_hr: ['walking_hr_avg', (v) => v],
  hr_avg: ['heart_rate_avg', (v) => v],
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
// ISO 8601 with an offset, which is what Shortcuts' Format Date writes.
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:?\d{2}|Z)$/

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toKind(name: string): WorkoutKind {
  const s = name.toLowerCase()
  if (s.includes('strength') || s.includes('interval') || s.includes('crossfit')) return 'strength'
  if (s.includes('run')) return 'run'
  if (s.includes('cycl') || s.includes('ride') || s.includes('bike')) return 'ride'
  if (s.includes('swim')) return 'swim'
  if (s.includes('walk') || s.includes('hik')) return 'walk'
  return 'other'
}

export function toReadings(payload: unknown): { metrics: BodyMetric[]; workouts: Workout[] } {
  const p = (payload ?? {}) as { day?: unknown; metrics?: unknown; workouts?: unknown }
  const day = typeof p.day === 'string' && DAY.test(p.day) ? p.day : null
  if (!day) return { metrics: [], workouts: [] }

  const metrics: BodyMetric[] = []
  const given = (p.metrics ?? {}) as Record<string, unknown>
  for (const [key, [kind, scale]] of Object.entries(METRICS)) {
    const v = num(given[key])
    if (v !== null) metrics.push({ kind, measuredOn: day, value: Math.round(scale(v)) })
  }

  const workouts: Workout[] = []
  for (const w of (Array.isArray(p.workouts) ? p.workouts : []) as Record<string, unknown>[]) {
    // No HealthKit id reaches a Shortcut, so the start instant is the identity:
    // two workouts cannot start at the same second.
    const start = typeof w.start === 'string' && STAMP.test(w.start) ? w.start : null
    const minutes = num(w.minutes)
    if (!start || minutes === null) continue
    const name = typeof w.name === 'string' && w.name ? w.name : 'Workout'
    const miles = num(w.miles)
    const km = num(w.km)
    const kcal = num(w.kcal)
    const avgHr = num(w.avg_hr)
    workouts.push({
      externalId: start,
      name,
      kind: toKind(name),
      startedAt: start,
      durationS: Math.round(minutes * 60),
      // To the centimetre, which is what the distance column keeps.
      distanceM: miles !== null ? Math.round(miles * METRES_PER_MI * 100) / 100 : km !== null ? Math.round(km * 100000) / 100 : 0,
      avgHr: avgHr !== null ? Math.round(avgHr) : null,
      detail: kcal !== null ? `${Math.round(kcal)} kcal` : '',
      // The Shortcut sends no scalars past the columns.
      stats: {},
    })
  }

  return { metrics, workouts }
}
