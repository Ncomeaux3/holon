import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOwner } from '@/core/auth'
import { db } from '@/core/db'
import { withLog } from '@/core/log'

// One insert, nothing else waits on it.
export const maxDuration = 10

// What error.tsx and global-error.tsx post when a page fails to render, so the
// failure is readable in the Agent log's Errors tab and not only in Vercel's
// logs. Bounded fields: a runaway stack is cut, not refused.
const schema = z.object({
  route: z.string().min(1).max(500),
  digest: z.string().max(100).optional(),
  message: z.string().min(1).max(2000),
  stack: z.string().max(20_000).optional(),
})

async function handle(request: Request) {
  // proxy.ts already redirects a visitor without the owner cookie away from
  // every /api route; this is the same backstop the OAuth start route keeps.
  await requireOwner()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body is not JSON' }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Payload does not match the expected shape', issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    )
  }

  const { route, digest, message, stack } = parsed.data
  await db().query(
    `insert into core.client_errors (route, digest, message, stack, user_agent)
     values ($1, $2, $3, $4, $5)`,
    [route, digest ?? null, message, stack ?? null, request.headers.get('user-agent')],
  )
  return NextResponse.json({ ok: true })
}

export const POST = withLog(handle)
