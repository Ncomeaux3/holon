// The split behind scripts/hae-backfill.mts, kept pure so a test can pin it.

import { toBodyMetrics } from '@/integrations/health_auto_export/client'

type Point = Record<string, unknown>
type Metric = { name: string; units?: string; data?: Point[] }
type Payload = { data: { metrics?: Metric[]; workouts?: Point[] } }

const WORKOUTS_PER_REQUEST = 20

/**
 * One request per calendar month carrying that month's points of every
 * metric, then the workouts twenty at a time. A month is well under the
 * function's body and time limits at daily aggregation, and a day's points
 * never straddle two requests, so a total summed across a day is summed once.
 * The month is the first seven characters of the app's `yyyy-MM-dd ...` date;
 * a point without one is bucketed under '?' so nothing is silently dropped.
 */
export function chunk(payload: Payload): Payload[] {
  const byMonth = new Map<string, Metric[]>()
  for (const metric of payload.data.metrics ?? []) {
    const groups = new Map<string, Point[]>()
    for (const point of metric.data ?? []) {
      const month = typeof point.date === 'string' ? point.date.slice(0, 7) : '?'
      groups.set(month, [...(groups.get(month) ?? []), point])
    }
    for (const [month, data] of groups) {
      byMonth.set(month, [...(byMonth.get(month) ?? []), { ...metric, data }])
    }
  }
  const out: Payload[] = [...byMonth.keys()].sort().map((month) => ({ data: { metrics: byMonth.get(month) } }))

  // A workout from the app carries its route and per-minute series, megabytes
  // the module never reads; only the scalars go, so a request stays small.
  const workouts = (payload.data.workouts ?? []).map((w) =>
    Object.fromEntries(Object.entries(w).filter(([, v]) => !Array.isArray(v))),
  )
  for (let i = 0; i < workouts.length; i += WORKOUTS_PER_REQUEST) {
    out.push({ data: { workouts: workouts.slice(i, i + WORKOUTS_PER_REQUEST) } })
  }
  return out
}

export type Options = {
  file: string
  url: string
  dryRun: boolean
  /** Print the export's sleep nights and send nothing. */
  sleep: boolean
}

/**
 * The flags in any order around one export file. `--url` takes the token
 * after it, so `--url <url> export.json` names the file rather than the URL,
 * which the first-non-flag read did. An unrecognised flag is an error rather
 * than a no-op: `--dryrun` silently meant a live post to production.
 */
export function parseArgs(argv: string[], defaultUrl: string): Options {
  let file: string | null = null
  let url = defaultUrl
  let dryRun = false
  let sleep = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--url') {
      const value = argv[++i]
      if (value === undefined || value.startsWith('--')) throw new Error('--url needs a URL after it')
      url = value
    } else if (arg === '--dry-run') dryRun = true
    else if (arg === '--sleep') sleep = true
    else if (arg.startsWith('--')) throw new Error(`unknown flag ${arg}`)
    else if (file === null) file = arg
    else throw new Error(`one export file at a time, given ${file} and ${arg}`)
  }
  if (file === null) throw new Error('no export file given')
  return { file, url, dryRun, sleep }
}

export type SleepPoint = {
  /** `sleepStart` and `sleepEnd` as the app wrote them, or '' when absent. */
  start: string
  end: string
  /** What this point alone would store: its span, or its hours when it has none. */
  ownMin: number | null
  totalSleepMin: number | null
  asleepMin: number | null
  inBedMin: number | null
}

export type SleepNight = {
  /** The day the webhook dates the night to, or '?' when neither end reads. */
  day: string
  /** That day's points, in the order the export wrote them. */
  points: SleepPoint[]
  /** The minutes the day collapses to once every one of its points is read. */
  storedMin: number | null
}

const asText = (value: unknown) => (typeof value === 'string' ? value : '')
const asMinutes = (hours: unknown) =>
  typeof hours === 'number' && Number.isFinite(hours) ? Math.round(hours * 60) : null

/** The day and minutes the webhook would store for these sleep points. */
function stored(data: Point[]): { day: string; min: number } | null {
  const [row] = toBodyMetrics({ data: { metrics: [{ name: 'sleep_analysis', units: 'hr', data }] } })
  return row ? { day: row.measuredOn, min: row.value } : null
}

/**
 * Every sleep_analysis point in the export beside the minutes the webhook
 * would store for its night, so a night that reads wrong is found in the file
 * rather than guessed at. It runs the webhook's own translation, so what it
 * prints is what would be stored and not a second implementation of it. Two
 * points under one day is the case worth looking for: the day keeps the last
 * of them, so a short nap can outrank the night it shares a date with.
 */
export function sleepReport(payload: Payload): SleepNight[] {
  const points = (payload.data.metrics ?? [])
    .filter((metric) => metric.name === 'sleep_analysis')
    .flatMap((metric) => metric.data ?? [])

  const byDay = new Map<string, Point[]>()
  for (const point of points) {
    // The webhook's date rule (sleepEnd, else date), read here rather than
    // through stored() so a night the webhook skips still lands on its day.
    const day = (asText(point.sleepEnd) || asText(point.date)).slice(0, 10) || '?'
    byDay.set(day, [...(byDay.get(day) ?? []), point])
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, data]) => ({
      day,
      storedMin: stored(data)?.min ?? null,
      points: data.map((point) => ({
        start: asText(point.sleepStart),
        end: asText(point.sleepEnd),
        ownMin: stored([point])?.min ?? null,
        totalSleepMin: asMinutes(point.totalSleep),
        asleepMin: asMinutes(point.asleep),
        inBedMin: asMinutes(point.inBed),
      })),
    }))
}
