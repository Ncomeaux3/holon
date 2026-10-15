import { createHash } from 'node:crypto'

// Per IP, in memory, in front of every API route. The edge is the real defence
// against a flood; this is the backstop that keeps one caller from hammering a
// route that talks to Postgres or a paid provider.
//
// Per process, so on serverless it is approximate: each instance keeps its own
// count. That is fine for what it is here, and Vercel Firewall does the part
// that has to be exact.

const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 60

const hits = new Map<string, number[]>()

/**
 * Never store a raw address. The request log holds the same hash, so a burst
 * can be traced across routes without the log becoming a list of who called.
 */
export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 16)
}

/** The caller's address, as far behind a proxy as can be trusted. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') ?? 'unknown'
}

export type RateVerdict = { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number }

export function check(key: string, now = Date.now()): RateVerdict {
  const cutoff = now - WINDOW_MS
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff)

  if (recent.length >= MAX_PER_WINDOW) {
    // Oldest call in the window decides when the next one is allowed.
    const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000))
    hits.set(key, recent)
    return { ok: false, retryAfterSeconds }
  }

  recent.push(now)
  hits.set(key, recent)

  // Keys go stale as soon as their window empties. Without this the map grows
  // for the life of the process.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => t <= cutoff)) hits.delete(k)
  }

  return { ok: true, remaining: MAX_PER_WINDOW - recent.length }
}

/** The 429 every route returns, with the header a well behaved client obeys. */
export function tooManyRequests(retryAfterSeconds: number): Response {
  return new Response(JSON.stringify({ error: 'Too many requests' }), {
    status: 429,
    headers: { 'content-type': 'application/json', 'retry-after': String(retryAfterSeconds) },
  })
}

/** Test seam. Nothing in the app should need this. */
export function reset(): void {
  hits.clear()
}
