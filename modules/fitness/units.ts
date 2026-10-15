// Units and the few derived numbers the Fitness screen shows. One import,
// core/clock.ts, which is itself import free: the screen is a client component
// and anything reaching core/db.ts drags pg into the browser bundle.

import { clockIn, isoDateIn } from '@/core/clock'
//
// Everything is stored unit free and integer: grams for mass, metres for
// distance, seconds for time. Pounds and miles are a rendering decision, and
// storing either system makes the other lossy. Imperial is what these
// functions render by default, because the owner reads imperial.

const GRAMS_PER_POUND = 453.59237
export const METRES_PER_MILE = 1609.344
const METRES_PER_FOOT = 0.3048

/** Rows per page of the workout list; the screen asks for another page at a time. */
export const WORKOUT_PAGE = 40
const METRES_PER_YARD = 0.9144

export type MassUnit = 'lb' | 'kg'
/** Yards are for pool swims: many US pools are 25 yd and a swim is counted in lengths of it. */
export type DistanceUnit = 'mi' | 'km' | 'yd'

/** "275 lb", "142.5 kg". Rounded to the increment the unit is actually loaded in. */
export function mass(grams: number, unit: MassUnit = 'lb'): string {
  if (unit === 'kg') {
    // Plates come in 2.5kg and 1.25kg, so half a kilo is the finest that ever
    // means anything.
    return `${(Math.round(grams / 500) / 2).toLocaleString('en-US')} kg`
  }
  return `${Math.round(grams / GRAMS_PER_POUND).toLocaleString('en-US')} lb`
}

export const toGrams = (value: number, unit: MassUnit): number =>
  Math.round(unit === 'kg' ? value * 1000 : value * GRAMS_PER_POUND)

/**
 * "3.17 mi", "410 ft". Feet until a mile is the more readable number.
 *
 * Miles are the default because the owner is in the US and every source the
 * app reads from (Apple Health, Strava) is set to imperial there. Metres stay
 * the stored unit: the conversion belongs here, once, and not in the column.
 */
export function distance(metres: number, unit: DistanceUnit = 'mi'): string {
  if (metres === 0) return ''
  if (unit === 'yd') return `${Math.round(metres / METRES_PER_YARD).toLocaleString('en-US')} yd`
  if (unit === 'km') {
    return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`
  }
  // A tenth of a mile is where the decimals stop saying anything useful.
  if (metres < METRES_PER_MILE / 10) {
    return `${Math.round(metres / METRES_PER_FOOT).toLocaleString('en-US')} ft`
  }
  // Two decimals, as every run tracker shows a distance: 3.2 and 3.24 are a
  // hundred and thirty yards apart, which is a lap of a track.
  return `${(metres / METRES_PER_MILE).toFixed(2)} mi`
}

/**
 * "Sep 12", the row's date in the owner's zone. Not `getDate()`: a client
 * component is also rendered on the server, where that is UTC, so a 20:30
 * run would be dated tomorrow there and mismatch on hydration.
 */
export function shortDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: '2-digit' }).format(new Date(iso))
}

/** "6:42 am", the row's start time in the owner's zone, through core/clock.ts for the same reason as shortDate. */
export function clock12(iso: string, timeZone: string): string {
  const [h, m] = clockIn(new Date(iso), timeZone).split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

/** "6.6 mph" from metres per second. */
export const speed = (mps: number): string => `${((mps * 3600) / METRES_PER_MILE).toFixed(1)} mph`

/** "147 ft" of climb from metres. */
export const elevation = (metres: number): string =>
  `${Math.round(metres / METRES_PER_FOOT).toLocaleString('en-US')} ft`

/** "90°F" from Celsius. */
export const temperature = (c: number): string => `${Math.round((c * 9) / 5 + 32)}°F`

/** "58m", "1h 02m". What a workout duration reads as in a list. */
export function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/**
 * Pace, as minutes and seconds per mile.
 *
 * The one number a runner actually reads, and it is a ratio of two stored
 * values rather than a stored value, so it can never disagree with them.
 */
export function pace(metres: number, seconds: number, unit: DistanceUnit = 'mi'): string {
  if (metres < 100 || seconds <= 0) return ''
  // Swimmers pace per hundred yards, not per mile.
  const per = unit === 'km' ? 1000 : unit === 'yd' ? 100 * METRES_PER_YARD : METRES_PER_MILE
  const label = unit === 'yd' ? '100yd' : unit
  const secondsPer = seconds / (metres / per)
  const m = Math.floor(secondsPer / 60)
  const s = Math.round(secondsPer % 60)
  // 9:60 is what naive rounding produces, and it is not a time.
  return s === 60 ? `${m + 1}:00/${label}` : `${m}:${String(s).padStart(2, '0')}/${label}`
}

export type SetLike = { reps: number; weightG: number }

/**
 * The heaviest set, and the heaviest at that weight.
 *
 * "Best" is by weight first, then by reps, because 275 for five beats 275 for
 * three and both beat 245 for ten. A one rep max estimate would be a guess
 * dressed as a number, and the screen shows what actually happened instead.
 */
export function bestSet(sets: SetLike[]): SetLike | null {
  if (sets.length === 0) return null
  return sets.reduce((best, set) => {
    if (set.weightG !== best.weightG) return set.weightG > best.weightG ? set : best
    return set.reps > best.reps ? set : best
  })
}

/**
 * Training load for a week: minutes, weighted by how hard the work was.
 *
 * Deliberately crude and deliberately visible. There is a literature of
 * training load models and every one of them needs data this app does not have,
 * so this multiplies duration by a per-kind factor and says so. A number
 * presented as science that is really a guess is worse than an honest guess.
 */
const INTENSITY: Record<string, number> = {
  strength: 1.2,
  run: 1.4,
  ride: 1,
  swim: 1.3,
  walk: 0.5,
  other: 1,
}

export function load(workouts: { kind: string; durationS: number }[]): number {
  return Math.round(
    workouts.reduce((sum, w) => sum + (w.durationS / 60) * (INTENSITY[w.kind] ?? 1), 0),
  )
}

/** "Today", "Yesterday", then "Sep 04": when a set happened, for a tile's sub-line. */
export function whenLabel(iso: string, todayIso: string, timeZone: string): string {
  const day = isoDateIn(new Date(iso), timeZone)
  const today = new Date(`${todayIso}T00:00:00Z`)
  const days = Math.round((today.getTime() - new Date(`${day}T00:00:00Z`).getTime()) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return monthDay(day)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Sep 04" from a date or timestamp string. */
export function monthDay(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(8, 10)}`
}

/** "2h 41m", "51m": the week's training time as the tile sub-line prints it. */
export function hoursLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** "8 Strava · 3 Apple Health · 2 by hand": where the rows shown came from. Zeros are left out. */
export function sourcesLabel(rows: { source: string }[]): string {
  const strava = rows.filter((r) => r.source === 'strava').length
  const apple = rows.filter((r) => r.source === 'health_auto_export' || r.source === 'apple_shortcuts').length
  const hand = rows.length - strava - apple
  return [strava > 0 && `${strava} Strava`, apple > 0 && `${apple} Apple Health`, hand > 0 && `${hand} by hand`]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Which screen the page draws. A missing provider is a banner, not a wall:
 * any workout at all, whatever its source, means the overview.
 *
 * Readings count the same way. The phone sources send body metrics and no
 * workouts, so counting workouts alone left a Fitness page with a week of
 * readings on it still drawing the Connect Strava card.
 */
export function screenState(args: {
  workouts: number
  metrics: number
  connected: boolean
}): 'setup' | 'setup-connected' | 'live' {
  if (args.workouts > 0 || args.metrics > 0) return 'live'
  return args.connected ? 'setup-connected' : 'setup'
}
