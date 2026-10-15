import { db } from './db'
import { check, clientIp, hashIp, tooManyRequests } from './ratelimit'

// One wrapper around every route under app/api. It rate limits, times the
// call, and writes core.request_log, so Vercel's short log retention is not the
// only record of what reached this app.

type Handler<C> = (request: Request, context: C) => Promise<Response> | Response

/** Never throws. A logging failure must not turn a 200 into a 500. */
async function record(row: {
  route: string
  method: string
  status: number
  durationMs: number
  ipHash: string | null
  error?: string
}): Promise<void> {
  try {
    await db().query(
      `insert into core.request_log (route, method, status, duration_ms, ip_hash, error)
       values ($1, $2, $3, $4, $5, $6)`,
      [row.route, row.method, row.status, row.durationMs, row.ipHash, row.error ?? null],
    )
  } catch {
    // Swallowed on purpose: the request already succeeded or failed on its own
    // terms, and the caller should not learn about our bookkeeping.
  }
}

/**
 * A failure that a job or tool catches and carries on past, written where the
 * Errors tab reads: a request_log row with method `internal` and status 500,
 * `where` naming the code path ("brain.hubs.file"). For a catch that would
 * otherwise be silent; a parser falling back on bad input is not an error.
 */
export async function recordError(where: string, error: unknown): Promise<void> {
  await record({
    route: where,
    method: 'internal',
    status: 500,
    durationMs: 0,
    ipHash: null,
    error: error instanceof Error ? error.message : String(error),
  })
}

/**
 * Wraps a route handler with the rate limiter and the request log.
 *
 * A handler that throws is logged as a 500 and the error re-thrown, so Next
 * still renders its own error response and nothing is swallowed.
 */
export function withLog<C>(handler: Handler<C>): Handler<C> {
  return async (request, context) => {
    const started = Date.now()
    const route = new URL(request.url).pathname
    const ipHash = hashIp(clientIp(request))

    const verdict = check(ipHash)
    if (!verdict.ok) {
      const response = tooManyRequests(verdict.retryAfterSeconds)
      await record({
        route,
        method: request.method,
        status: 429,
        durationMs: Date.now() - started,
        ipHash,
        error: 'rate limited',
      })
      return response
    }

    try {
      const response = await handler(request, context)
      await record({
        route,
        method: request.method,
        status: response.status,
        durationMs: Date.now() - started,
        ipHash,
      })
      return response
    } catch (error) {
      await record({
        route,
        method: request.method,
        status: 500,
        durationMs: Date.now() - started,
        ipHash,
        error: error instanceof Error ? error.message : 'unknown',
      })
      throw error
    }
  }
}
