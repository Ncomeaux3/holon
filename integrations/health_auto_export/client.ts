// The translation from a Health Auto Export payload to the rows the Fitness
// module stores. Pure and import free, so the module can call it and a test
// can feed it a payload without a database.
//
// The shape, from the app's export-format page (help.healthyapps.dev, checked
// 2026-09-12): data.metrics[] { name, units, data[] }, each point { qty, date },
// dates `yyyy-MM-dd HH:mm:ss Z`. Confirmed there: `resting_heart_rate`,
// `sleep_analysis`, and the snake_case naming rule. Verify against one real
// export (owner step 14): `weight_body_mass`, `heart_rate_variability`,
// `body_fat_percentage`, and the sleep field `totalSleep` (`asleep`, `inBed`,
// `sleepStart`, `sleepEnd` are used by an unofficial client and are likelier).

export type BodyMetricKind =
  | 'weight'
  | 'resting_hr'
  | 'hrv'
  | 'sleep_minutes'
  | 'body_fat'
  | 'steps'
  | 'active_energy'
  | 'exercise_minutes'
  | 'stand_hours'
  | 'vo2_max'
  | 'blood_oxygen'
  | 'respiratory_rate'
  | 'flights_climbed'
  | 'walking_distance'
  | 'walking_hr_avg'
  | 'heart_rate_avg'

export type BodyMetric = {
  kind: BodyMetricKind
  /** YYYY-MM-DD, the phone's local day. */
  measuredOn: string
  /** One integer unit per kind, named in the fitness_metric_kinds migration. */
  value: number
}

export type WorkoutKind = 'strength' | 'run' | 'ride' | 'swim' | 'walk' | 'other'

export type Workout = {
  externalId: string
  name: string
  kind: WorkoutKind
  /** The app's own timestamp, offset included, for Postgres to parse. */
  startedAt: string
  durationS: number
  distanceM: number
  avgHr: number | null
  /** The energy line, or empty. */
  detail: string
  stats: WorkoutStats
}

/**
 * Every scalar a v2 workout carries beyond the columns, in the app's units:
 * seconds, metres, m/s, kcal, bpm, degrees C, percent, MET. A key the app did
 * not send is absent, never null. Stored as fitness.workout.stats.
 */
export type WorkoutStats = {
  /** ISO 8601 with the phone's offset, so a browser can parse it. */
  endedAt?: string
  /** Indoor, Outdoor, Pool, Open Water. */
  location?: string
  activeKcal?: number
  totalKcal?: number
  met?: number
  avgSpeedMps?: number
  maxSpeedMps?: number
  elevationUpM?: number
  elevationDownM?: number
  tempC?: number
  humidityPct?: number
  minHr?: number
  maxHr?: number
  steps?: number
  cadenceSpm?: number
  flights?: number
  lapLengthM?: number
  strokes?: number
}

const GRAMS_PER_LB = 453.59237
const METRES_PER_MI = 1609.344
const METRES_PER_YD = 0.9144
const KJ_PER_KCAL = 4.184

/** Metres to the centimetre, which is what the distance column keeps. */
const cm = (metres: number) => Math.round(metres * 100) / 100

// A night longer than this is a phantom session, not sleep: 10 of 225 Eight
// Sleep nights in the 2026-09-19 export had every field over 14 hours. It is
// skipped, so the day is a gap rather than a spike on the trend.
const MAX_NIGHT_MIN = 14 * 60

/**
 * A total is summed across the day's points, because the app can be set to
 * send hourly buckets and a day's steps is not its last hour's. Everything
 * else is a level, and the last reading of the day stands.
 */
const TOTALS: ReadonlySet<BodyMetricKind> = new Set([
  'steps',
  'active_energy',
  'exercise_minutes',
  'stand_hours',
  'flights_climbed',
  'walking_distance',
])

// yyyy-MM-dd HH:mm:ss Z, as the app writes it. The day is the first ten
// characters, taken as the phone's local day rather than converted to UTC:
// a 23:30 reading in Central is still that evening's reading.
const DATE = /^(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}:\d{2} [+-]\d{4}$/

function day(value: unknown): string | null {
  const m = typeof value === 'string' ? DATE.exec(value) : null
  return m ? m[1] : null
}

/** Minutes from one app timestamp to another, or null when either does not read or the order is wrong. */
function minutesBetween(from: unknown, to: unknown): number | null {
  const a = instant(from)
  const b = instant(to)
  return a !== null && b !== null && b > a ? (b - a) / 60_000 : null
}

// `yyyy-MM-dd HH:mm:ss Z` to ISO 8601: Date.parse wants a T and a colon in
// the offset.
const iso = (value: string) => value.replace(' ', 'T').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2')

// The app's timestamp to epoch milliseconds.
function instant(value: unknown): number | null {
  if (typeof value !== 'string' || !DATE.test(value)) return null
  const ms = Date.parse(iso(value))
  return Number.isFinite(ms) ? ms : null
}

function qty(point: Record<string, unknown>, key = 'qty'): number | null {
  const v = point[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

type Point = Record<string, unknown>
type Translate = (point: Point, units: string) => BodyMetric | null

/**
 * One reading per point: the day from `date`, the number from `qty`. A scale
 * that returns null says the units are not ones it can convert, and the point
 * is skipped rather than stored under a guessed unit. Values are left
 * unrounded here so a total can be summed before it is rounded.
 */
const simple =
  (kind: BodyMetricKind, scale: (qty: number, units: string) => number | null): Translate =>
  (point, units) => {
    const measuredOn = day(point.date)
    const q = qty(point)
    if (!measuredOn || q === null) return null
    const value = scale(q, units)
    return value === null ? null : { kind, measuredOn, value }
  }

const identity = (q: number) => q
const tenths = (q: number) => q * 10

const mass = (q: number, units: string) => {
  // Only the two units the app documents for body mass. Anything else, a
  // missing units string included, is skipped: 185 stored as kilograms is a
  // wrong row the owner would have to notice by eye.
  const u = units.toLowerCase()
  return u.startsWith('lb') ? q * GRAMS_PER_LB : u.startsWith('kg') ? q * 1000 : null
}

const length = (q: number, units: string) => {
  const u = units.toLowerCase()
  if (u.startsWith('mi')) return q * METRES_PER_MI
  if (u.startsWith('km')) return q * 1000
  // Pool swims can arrive in yards.
  if (u.startsWith('yd')) return q * METRES_PER_YD
  return u === 'm' ? q : null
}

/**
 * Energy as kilocalories, whatever the phone is set to send.
 *
 * Unlike mass and length this does not skip what it cannot read: kilocalories
 * are what Apple Health stores and what every US export has sent, so a missing
 * or unrecognised units string is taken as kcal rather than dropping the day's
 * energy. Only kilojoules are converted, because only kilojoules are wrong by
 * a factor rather than wrong by a name.
 */
const energy = (q: number, units: string) => {
  const u = units.toLowerCase()
  return u === 'kj' || u.startsWith('kilojoule') ? q / KJ_PER_KCAL : q
}

const byName: Record<string, Translate> = {
  // The docs spell it with an ampersand; the older spelling is what an
  // unofficial client reads. Both land on weight.
  weight_body_mass: simple('weight', mass),
  'weight_&_body_mass': simple('weight', mass),
  resting_heart_rate: simple('resting_hr', identity),
  heart_rate_variability: simple('hrv', identity),
  body_fat_percentage: simple('body_fat', tenths),
  // The night is dated by the morning it ended so it belongs to the day you
  // woke up. Its length is the smaller of the span from sleepStart to sleepEnd
  // and the app's summed hours (`totalSleep`, then the older `asleep`),
  // because a sleep tracker can get each one wrong on different nights:
  // overlapping records make the hours two to three times the night, and a
  // session that ends in the afternoon makes the span 13 to 20 hours while
  // the hours read right. A point with
  // only one of the two reads that one.
  sleep_analysis: (point) => {
    const measuredOn = day(point.sleepEnd) ?? day(point.date)
    const span = minutesBetween(point.sleepStart, point.sleepEnd)
    const hours = qty(point, 'totalSleep') ?? qty(point, 'asleep')
    const summed = hours === null ? null : hours * 60
    const value = span === null ? summed : summed === null ? span : Math.min(span, summed)
    if (!measuredOn || value === null || value > MAX_NIGHT_MIN) return null
    return { kind: 'sleep_minutes', measuredOn, value }
  },
  step_count: simple('steps', identity),
  active_energy: simple('active_energy', energy),
  apple_exercise_time: simple('exercise_minutes', identity),
  // The count of hours stood, not `apple_stand_time`, which is minutes
  // (99 for 11 hours in the 2026-09-18 export) and is left unmapped.
  apple_stand_hour: simple('stand_hours', identity),
  vo2_max: simple('vo2_max', tenths),
  blood_oxygen_saturation: simple('blood_oxygen', tenths),
  respiratory_rate: simple('respiratory_rate', tenths),
  flights_climbed: simple('flights_climbed', identity),
  walking_running_distance: simple('walking_distance', length),
  walking_heart_rate_average: simple('walking_hr_avg', identity),
  // The docs give heart_rate as Min/Avg/Max on one point rather than qty.
  heart_rate: (point) => {
    const measuredOn = day(point.date)
    const avg = qty(point, 'Avg') ?? qty(point, 'avg')
    return measuredOn && avg !== null ? { kind: 'heart_rate_avg', measuredOn, value: avg } : null
  },
}

/**
 * Every reading the payload carries that the body_metric table has a kind
 * for, one row per kind and day. Unknown metrics and any point whose date or
 * number does not read are skipped, never thrown: one odd record must not
 * lose the rest.
 */
export function toBodyMetrics(payload: unknown): BodyMetric[] {
  const data = (payload as { data?: { metrics?: unknown } } | null)?.data
  const metrics = Array.isArray(data?.metrics) ? data.metrics : []
  const byDay = new Map<string, BodyMetric>()

  for (const metric of metrics as { name?: unknown; units?: unknown; data?: unknown }[]) {
    const translate = typeof metric.name === 'string' ? byName[metric.name] : undefined
    if (!translate || !Array.isArray(metric.data)) continue
    const units = typeof metric.units === 'string' ? metric.units : ''
    for (const point of metric.data as Point[]) {
      const row = translate(point, units)
      if (!row) continue
      const key = `${row.kind} ${row.measuredOn}`
      const seen = byDay.get(key)
      if (seen && TOTALS.has(row.kind)) seen.value += row.value
      else byDay.set(key, seen ? { ...seen, value: row.value } : row)
    }
  }
  return [...byDay.values()].map((m) => ({ ...m, value: Math.round(m.value) }))
}

/** Rounded to `places` decimals. */
const round = (v: number, places = 0) => Math.round(v * 10 ** places) / 10 ** places

/**
 * m/s from the app's speed. Every speed in the 2026-09-19 export was per hour
 * (`mi/hr`, `yd/hr`, and a bare `mi` on avgSpeed and maxSpeed that is mph by
 * its numbers), so per hour is the default and only `/s` is taken as per second.
 */
function speed(q: { qty: number; units: string }): number | null {
  const [num, per] = q.units.split('/')
  const m = length(q.qty, num === 'mph' ? 'mi' : num)
  return m === null ? null : per === 's' ? m : m / 3600
}

const feetOrMetres = (q: { qty: number; units: string }) =>
  q.units === 'ft' ? q.qty * 0.3048 : q.units === 'm' ? q.qty : null

const celsius = (q: { qty: number; units: string }) =>
  q.units.toLowerCase() === 'degf' ? ((q.qty - 32) * 5) / 9 : q.units.toLowerCase() === 'degc' ? q.qty : null

/** The scalars past the columns. Series (heart rate, route, energy, swim and cycling) are dropped. */
function toStats(w: Record<string, unknown>): WorkoutStats {
  const stats: WorkoutStats = {}
  const set = <K extends keyof WorkoutStats>(key: K, v: WorkoutStats[K] | null | undefined) => {
    if (v !== null && v !== undefined) stats[key] = v
  }
  const q = (key: string) => quantity(w[key])
  const n = (key: string, places = 0) => {
    const v = q(key)
    return v ? round(v.qty, places) : null
  }
  const hr = w.heartRate as { min?: unknown; max?: unknown } | undefined

  set('endedAt', typeof w.end === 'string' && DATE.test(w.end) ? iso(w.end) : null)
  set(
    'location',
    typeof w.location === 'string' && w.location
      ? w.location
      : w.isIndoor === true
        ? 'Indoor'
        : w.isIndoor === false
          ? 'Outdoor'
          : null,
  )
  const active = q('activeEnergyBurned')
  set('activeKcal', active && round(energy(active.qty, active.units)))
  const total = q('totalEnergy')
  set('totalKcal', total && round(energy(total.qty, total.units)))
  set('met', n('intensity', 1))
  const avg = q('avgSpeed') ?? q('speed')
  const avgMps = avg && speed(avg)
  set('avgSpeedMps', avgMps === null ? null : round(avgMps, 2))
  const max = q('maxSpeed')
  const maxMps = max && speed(max)
  set('maxSpeedMps', maxMps === null ? null : round(maxMps, 2))
  for (const [from, to] of [['elevationUp', 'elevationUpM'], ['elevationDown', 'elevationDownM']] as const) {
    const v = q(from)
    const m = v && feetOrMetres(v)
    set(to, m === null ? null : round(m, 1))
  }
  const temp = q('temperature')
  const c = temp && celsius(temp)
  set('tempC', c === null ? null : round(c, 1))
  set('humidityPct', n('humidity'))
  const minHr = quantity(hr?.min)
  set('minHr', minHr && round(minHr.qty))
  const maxHr = quantity(hr?.max) ?? q('maxHeartRate')
  set('maxHr', maxHr && round(maxHr.qty))
  // A series in every workout of the 2026-09-19 export; a scalar per the docs.
  const steps = Array.isArray(w.stepCount)
    ? (w.stepCount as Point[]).reduce((sum, p) => sum + (qty(p) ?? 0), 0)
    : (q('stepCount')?.qty ?? null)
  set('steps', steps === null ? null : round(steps))
  set('cadenceSpm', n('stepCadence'))
  set('flights', n('flightsClimbed'))
  const lap = q('lapLength')
  const lapM = lap && length(lap.qty, lap.units)
  set('lapLengthM', lapM === null ? null : cm(lapM))
  set('strokes', n('totalSwimmingStrokeCount'))
  return stats
}

/** The same word rules the Strava sync applies to its sport types. */
function toKind(name: string): WorkoutKind {
  const s = name.toLowerCase()
  if (s.includes('strength') || s.includes('interval') || s.includes('crossfit')) return 'strength'
  if (s.includes('run')) return 'run'
  if (s.includes('cycl') || s.includes('ride') || s.includes('bike')) return 'ride'
  if (s.includes('swim')) return 'swim'
  if (s.includes('walk') || s.includes('hik')) return 'walk'
  return 'other'
}

function quantity(v: unknown): { qty: number; units: string } | null {
  const o = v as { qty?: unknown; units?: unknown } | null
  const q = typeof o?.qty === 'number' && Number.isFinite(o.qty) ? o.qty : null
  return q === null ? null : { qty: q, units: typeof o?.units === 'string' ? o.units : '' }
}

/**
 * Every v2 workout the payload carries. `id`, `start` and `duration` are the
 * app's required fields and the ones an upsert needs; a workout missing any
 * (the v1 shape has no id) is skipped. Distance, heart rate and energy are
 * optional and land as zero, null and an empty detail.
 */
export function toWorkouts(payload: unknown): Workout[] {
  const data = (payload as { data?: { workouts?: unknown } } | null)?.data
  const workouts = Array.isArray(data?.workouts) ? data.workouts : []
  const out: Workout[] = []

  for (const w of workouts as Record<string, unknown>[]) {
    const externalId = typeof w.id === 'string' ? w.id : null
    const startedAt = typeof w.start === 'string' && DATE.test(w.start) ? w.start : null
    const duration = qty(w, 'duration')
    if (!externalId || !startedAt || duration === null) continue

    const name = typeof w.name === 'string' && w.name ? w.name : 'Workout'
    const distance = quantity(w.distance)
    const metres = distance ? length(distance.qty, distance.units) : null
    const hr = quantity((w.heartRate as { avg?: unknown } | undefined)?.avg)
    const burned = quantity(w.activeEnergyBurned)

    out.push({
      externalId,
      name,
      kind: toKind(name),
      startedAt,
      durationS: Math.round(duration),
      distanceM: metres === null ? 0 : cm(metres),
      avgHr: hr ? Math.round(hr.qty) : null,
      detail: burned ? `${Math.round(energy(burned.qty, burned.units))} kcal` : '',
      stats: toStats(w),
    })
  }
  return out
}

/** Every kind, in the migration's order, for the tool schema and the screen. */
export const BODY_METRIC_KINDS = [
  'weight',
  'resting_hr',
  'hrv',
  'sleep_minutes',
  'body_fat',
  'steps',
  'active_energy',
  'exercise_minutes',
  'stand_hours',
  'vo2_max',
  'blood_oxygen',
  'respiratory_rate',
  'flights_climbed',
  'walking_distance',
  'walking_hr_avg',
  'heart_rate_avg',
] as const satisfies readonly BodyMetricKind[]
