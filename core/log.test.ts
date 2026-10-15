import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { withLog } from './log'
import { reset } from './ratelimit'

const req = (path = '/api/thing', method = 'GET') =>
  new Request(`http://localhost:3000${path}`, {
    method,
    headers: { 'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 250) + 1}` },
  })

const rows = async () =>
  (
    await db().query<{ route: string; method: string; status: number; ip_hash: string; error: string | null }>(
      'select route, method, status, ip_hash, error from core.request_log order by occurred_at',
    )
  ).rows

beforeEach(async () => {
  reset()
  await db().query('delete from core.request_log')
})

afterAll(async () => {
  await db().end()
})

describe('withLog', () => {
  it('records the route, method and status of a successful call', async () => {
    const handler = withLog(async () => new Response('ok', { status: 201 }))
    const response = await handler(req('/api/cron/nightly', 'POST'), undefined as never)

    expect(response.status).toBe(201)
    expect(await rows()).toMatchObject([
      { route: '/api/cron/nightly', method: 'POST', status: 201, error: null },
    ])
  })

  it('stores a hash rather than the address', async () => {
    const handler = withLog(async () => new Response('ok'))
    await handler(req(), undefined as never)

    const [row] = await rows()
    expect(row.ip_hash).not.toContain('203.0.113')
    expect(row.ip_hash).toHaveLength(16)
  })

  it('logs a thrown handler as a 500 and re-throws it', async () => {
    const handler = withLog(async () => {
      throw new Error('boom')
    })

    await expect(handler(req(), undefined as never)).rejects.toThrow('boom')
    expect(await rows()).toMatchObject([{ status: 500, error: 'boom' }])
  })

  it('refuses a caller past the limit and logs the refusal', async () => {
    const handler = withLog(async () => new Response('ok'))
    const same = () =>
      new Request('http://localhost:3000/api/thing', { headers: { 'x-forwarded-for': '198.51.100.7' } })

    for (let i = 0; i < 60; i++) await handler(same(), undefined as never)
    const blocked = await handler(same(), undefined as never)

    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBeTruthy()

    const logged = await rows()
    expect(logged).toHaveLength(61)
    expect(logged.at(-1)).toMatchObject({ status: 429, error: 'rate limited' })
  })

  it('does not fail the request when logging fails', async () => {
    // The table is gone for the length of this call, which is the closest
    // stand-in for the database being unreachable mid request.
    await db().query('alter table core.request_log rename to request_log_hidden')
    try {
      const handler = withLog(async () => new Response('still fine', { status: 200 }))
      const response = await handler(req(), undefined as never)
      expect(response.status).toBe(200)
      await expect(response.text()).resolves.toBe('still fine')
    } finally {
      await db().query('alter table core.request_log_hidden rename to request_log')
    }
  })
})
