import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from './db'
import { copyText, failedJobsOf, listErrors, moduleOf, RANGES } from './errors'
import { recordError } from './log'

// The route is behind the owner cookie through proxy.ts and requireOwner();
// the test is about the payload, so the owner check is stood in for.
vi.mock('./auth', () => ({ requireOwner: async () => {} }))
const { POST: clientError } = await import('../app/api/client-error/route')

describe('moduleOf', () => {
  const known = ['finance', 'tasks']

  it('names the module from the first path segment when one owns it', () => {
    expect(moduleOf('/finance?view=budget', known)).toBe('finance')
    expect(moduleOf('/tasks/today', known)).toBe('tasks')
  })

  it('files everything else under system, api routes included', () => {
    expect(moduleOf('/api/mcp', known)).toBe('system')
    expect(moduleOf('/settings', known)).toBe('system')
    expect(moduleOf('tool:brain.ingest', known)).toBe('system')
  })
})

describe('failedJobsOf', () => {
  it('expands a run log to one row per failed job, with the provider detail', () => {
    const rows = failedJobsOf({
      id: 'run-1',
      started_at: new Date('2026-09-21T09:00:00Z'),
      log: {
        jobs: [
          { module: 'finance', name: 'sync_simplefin', status: 'failed', durationMs: 10, detail: 'auth_expired' },
          { module: 'ideas', name: 'nightly_digest', status: 'ok', durationMs: 5 },
          { module: 'core', name: 'embed', status: 'failed', durationMs: 2 },
        ],
      },
    })
    expect(rows).toEqual([
      { id: 'run-1:finance.sync_simplefin', at: new Date('2026-09-21T09:00:00Z'), module: 'finance', where: 'finance / sync_simplefin', text: 'auth_expired' },
      { id: 'run-1:core.embed', at: new Date('2026-09-21T09:00:00Z'), module: 'system', where: 'core / embed', text: 'failed, no detail recorded' },
    ])
  })

  it('reads an empty or malformed log as no failures', () => {
    expect(failedJobsOf({ id: 'r', started_at: new Date(), log: {} })).toEqual([])
  })
})

describe('copyText', () => {
  it('is route, time and text on one line, plain', () => {
    expect(copyText({ where: 'POST /api/mcp 500', when: '21 Sep 04:01', text: 'boom' })).toBe(
      'POST /api/mcp 500 · 21 Sep 04:01 · boom',
    )
  })
})

describe('listErrors', () => {
  beforeAll(async () => {
    await db().query(`delete from core.request_log`)
    await db().query(`delete from core.client_errors`)
    await db().query(`delete from core.job_runs`)
    await db().query(
      `insert into core.request_log (route, method, status, duration_ms, error, occurred_at) values
         ('/api/mcp', 'POST', 500, 12, 'relation does not exist', now()),
         ('/api/mcp', 'POST', 200, 12, null, now()),
         ('/api/cron/nightly', 'GET', 401, 3, 'bad token', now() - interval '3 days')`,
    )
    await db().query(
      `insert into core.client_errors (route, digest, message, occurred_at) values
         ('/finance', 'abc123', 'Cannot read properties of undefined', now())`,
    )
    await db().query(
      `insert into core.job_runs (trigger_source, status, started_at, log) values
         ('cron', 'partial', now(), '{"jobs":[{"module":"finance","name":"sync_simplefin","status":"failed","durationMs":1,"detail":"401"}]}'),
         ('cron', 'clean', now(), '{"jobs":[{"module":"finance","name":"sync_simplefin","status":"ok","durationMs":1}]}')`,
    )
  })
  afterAll(async () => {
    await db().query(`delete from core.request_log`)
    await db().query(`delete from core.client_errors`)
    await db().query(`delete from core.job_runs`)
  })

  it('returns only failures, in the window, with the modules present', async () => {
    const day = await listErrors({ range: '24h', known: ['finance'] })
    expect(day.requests.map((r) => r.where)).toEqual(['POST /api/mcp 500'])
    expect(day.requests[0].text).toBe('relation does not exist')
    expect(day.jobs.map((j) => j.where)).toEqual(['finance / sync_simplefin'])
    expect(day.client[0]).toMatchObject({ module: 'finance', where: '/finance', text: 'Cannot read properties of undefined', digest: 'abc123' })
    expect(day.modules).toEqual(['finance', 'system'])

    const week = await listErrors({ range: '7d', known: ['finance'] })
    expect(week.requests).toHaveLength(2)
  })

  it('filters every section by module', async () => {
    const finance = await listErrors({ range: '30d', known: ['finance'], module: 'finance' })
    expect(finance.requests).toHaveLength(0)
    expect(finance.jobs).toHaveLength(1)
    expect(finance.client).toHaveLength(1)
    // The module list is what exists in the window, not what the filter left.
    expect(finance.modules).toEqual(['finance', 'system'])
  })

  it('shows what recordError wrote, filed under system', async () => {
    await recordError('metric:fitness.weight', new Error('column gone'))
    const { requests } = await listErrors({ range: '24h', known: ['fitness'] })
    expect(requests[0]).toMatchObject({
      module: 'system',
      where: 'internal metric:fitness.weight 500',
      text: 'column gone',
    })
  })

  it('knows its three ranges', () => {
    expect(Object.keys(RANGES)).toEqual(['24h', '7d', '30d'])
  })
})

describe('POST /api/client-error', () => {
  const post = (body: unknown) =>
    clientError(
      new Request('http://localhost/api/client-error', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'test-agent' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      undefined,
    )

  afterAll(async () => {
    await db().query(`delete from core.client_errors`)
  })

  it('refuses a body that is not JSON, then one missing its message', async () => {
    expect((await post('{nope')).status).toBe(400)
    const res = await post({ route: '/x' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('shape') })
  })

  it('stores route, digest, message, stack and the user agent', async () => {
    const res = await post({ route: '/finance', digest: 'd1', message: 'boom', stack: 'Error: boom\n at x' })
    expect(res.status).toBe(200)
    const { rows } = await db().query(
      `select route, digest, message, stack, user_agent from core.client_errors where digest = 'd1'`,
    )
    expect(rows).toEqual([
      { route: '/finance', digest: 'd1', message: 'boom', stack: 'Error: boom\n at x', user_agent: 'test-agent' },
    ])
  })
})
