import { getCredentials } from '@/core/credentials'

// Strava's read API. Two calls: who the token belongs to, which is what the
// Connections Test button asks, and the activity list the Fitness sync reads.
//
// Nothing here refreshes a token. The generic nightly pass calls the manifest's
// refresh() before any module sync, so by the time this runs the stored access
// token is current. A 401 here means the connection is genuinely broken, not
// that it expired an hour ago.

const API = 'https://www.strava.com/api/v3'

export class StravaError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'StravaError'
  }
}

async function get<T>(path: string, accessToken?: string): Promise<T> {
  const token = accessToken ?? (await getCredentials('strava'))?.access_token
  if (!token) throw new StravaError(0, 'Strava is not connected. Connect it on Settings > Connections.')

  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    // Strava returns the rate limit state in headers rather than the body, and
    // the body on a 429 is unhelpful, so say which it was.
    const detail = res.status === 429 ? 'rate limited' : (await res.text()).slice(0, 200)
    throw new StravaError(res.status, `Strava ${res.status}: ${detail}`)
  }
  return (await res.json()) as T
}

export type Athlete = { id: number; username: string | null; firstname: string; lastname: string }

export function athlete(accessToken?: string): Promise<Athlete> {
  return get<Athlete>('/athlete', accessToken)
}

/** One activity, only the fields fitness.workout has somewhere to put. */
export type Activity = {
  id: number
  name: string
  /** Strava's own vocabulary: Run, Ride, Swim, Walk, WeightTraining, Workout... */
  sport_type: string
  /** ISO 8601 with an offset. */
  start_date: string
  /** Seconds of actual moving time, which is the honest number for a run. */
  moving_time: number
  elapsed_time: number
  /** Metres, as a float even for a treadmill. */
  distance: number
  average_heartrate?: number
}

/**
 * Activities after a point in time, newest first, one page.
 *
 * `after` rather than a full history: the sync runs nightly and asks for the
 * days it has not seen. A first run with no workouts stored asks for a year,
 * which is the caller's decision, not this function's.
 */
export async function activities(after: Date, perPage = 100): Promise<Activity[]> {
  const epoch = Math.floor(after.getTime() / 1000)
  return get<Activity[]>(`/athlete/activities?after=${epoch}&per_page=${perPage}`)
}

/**
 * Strava's sport_type onto the five kinds fitness.workout allows.
 *
 * Strava has upwards of forty sport types and the column has a check
 * constraint, so anything unrecognised has to land on 'other' rather than
 * fail the insert. That is a real outcome, not a gap: a windsurf is a workout.
 */
export function toKind(sportType: string): 'strength' | 'run' | 'ride' | 'swim' | 'walk' | 'other' {
  const s = sportType.toLowerCase()
  if (s.includes('weighttraining') || s.includes('crossfit') || s.includes('workout')) {
    return 'strength'
  }
  if (s.includes('run')) return 'run'
  if (s.includes('ride') || s.includes('bike') || s.includes('cycl')) return 'ride'
  if (s.includes('swim')) return 'swim'
  if (s.includes('walk') || s.includes('hike')) return 'walk'
  return 'other'
}
