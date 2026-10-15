import { timingSafeEqual } from 'node:crypto'
import { runNightly } from '@/core/jobs'
import { withLog } from '@/core/log'

// The one cron target. vercel.json fires it at 09:00 UTC; Vercel Hobby allows
// daily only and fires within the hour.

// Fluid compute gives 300s as both the default and the maximum, and the whole
// run has to fit inside it. Long work is chunked with a cursor in core.jobs.log.
export const maxDuration = 300

function secretMatches(provided: string | null): boolean {
  const expected = process.env.CRON_SECRET
  // An unset secret locks the route rather than opening it.
  if (!expected || !provided) return false

  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Vercel sends the secret as a bearer token. The Run now button on the
 * dashboard is a server action rather than a call to this route, so it needs no
 * secret: it is already behind requireOwner().
 */
async function handle(request: Request): Promise<Response> {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null
  if (!secretMatches(bearer)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  // Named moduleId, not module: `module` is a reserved binding in a Next route.
  // Retry now on the Agent Log uses this to re-run one module's jobs.
  const moduleId = new URL(request.url).searchParams.get('module') ?? undefined
  const summary = await runNightly({ trigger: 'cron', module: moduleId })

  return Response.json(summary)
}

export const GET = withLog(handle)
export const POST = withLog(handle)
