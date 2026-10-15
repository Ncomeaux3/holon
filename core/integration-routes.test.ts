import { randomBytes } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

// The routes read the state cookie through next/headers.
let cookieJar = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined),
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  }),
}))

// The start route is behind the owner check; these tests are the owner.
vi.mock('@/core/auth', () => ({ requireOwner: async () => ({}) }))

const { db } = await import('./db')
const { getCredentials, saveCredentials } = await import('./integrations')
const { expiryFrom, oauthStateCookie } = await import('./oauth')
const { GET: oauthStart } = await import('../app/api/integrations/[id]/oauth/start/route')
const { GET: oauthCallback } = await import('../app/api/integrations/[id]/oauth/callback/route')
const { POST: webhook } = await import('../app/api/integrations/[id]/webhook/route')

const SECRET_HEADER = 'x-pos-secret'

const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  cookieJar = new Map()
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64')
})
afterEach(async () => {
  await db().query('delete from core.connections')
  await db().query('delete from fitness.body_metric')
})
afterAll(async () => {
  await db().end()
})

describe('oauth callback', () => {
  const url = (qs: string) => `https://pos.example.com/api/integrations/strava/oauth/callback?${qs}`

  it('refuses when the callback carries no state at all', async () => {
    cookieJar.set(oauthStateCookie('strava'), 'the-expected-state')
    const res = await oauthCallback(new Request(url('code=abc')), params('strava'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('error=')
  })

  it('refuses when no state cookie was ever set', async () => {
    const res = await oauthCallback(new Request(url('code=abc&state=anything')), params('strava'))
    expect(res.headers.get('location')).toContain('error=')
  })

  it('refuses when the states differ', async () => {
    cookieJar.set(oauthStateCookie('strava'), 'expected')
    const res = await oauthCallback(new Request(url('code=abc&state=attacker')), params('strava'))
    expect(res.headers.get('location')).toContain('error=')
  })

  it('clears the state cookie so a callback cannot be replayed', async () => {
    cookieJar.set(oauthStateCookie('strava'), 'expected')
    await oauthCallback(new Request(url('code=abc&state=attacker')), params('strava'))
    expect(cookieJar.has(oauthStateCookie('strava'))).toBe(false)
  })

  it('404s for an integration that does not use oauth', async () => {
    const res = await oauthCallback(
      new Request('https://pos.example.com/api/integrations/anthropic/oauth/callback?state=x'),
      params('anthropic'),
    )
    expect(res.status).toBe(404)
  })

  it('reports the provider error rather than exchanging a code', async () => {
    cookieJar.set(oauthStateCookie('strava'), 'matching')
    const res = await oauthCallback(new Request(url('state=matching&error=access_denied')), params('strava'))
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toContain('access_denied')
  })
})

// v1.2 phase 7a. Google needs space separated scopes, offline access to earn a
// refresh token, and a form encoded token exchange; Strava keeps its comma and
// its approval_prompt.
describe('oauth, per provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("sends Google its scope, offline access and consent, and Strava its own", async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'google-client')
    vi.stubEnv('STRAVA_CLIENT_ID', 'strava-client')
    const start = async (id: string) =>
      new URL(
        (await oauthStart(new Request(`https://pos.example.com/api/integrations/${id}/oauth/start`), params(id))).headers.get(
          'location',
        ) ?? '',
      ).searchParams

    const google = await start('google')
    expect(google.get('scope')).toBe(
      'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly',
    )
    expect(google.get('access_type')).toBe('offline')
    expect(google.get('prompt')).toBe('consent')
    expect(google.get('redirect_uri')).toBe('https://pos.example.com/api/integrations/google/oauth/callback')
    expect(google.has('approval_prompt')).toBe(false)

    const strava = await start('strava')
    expect(strava.get('scope')).toBe('activity:read_all,profile:read_all')
    expect(strava.get('approval_prompt')).toBe('auto')
  })

  it('exchanges the code form encoded and stores the refresh token and expiry', async () => {
    let sent: unknown
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent = init.body
      return Response.json({ access_token: 'at', refresh_token: 'rt', expires_in: 3599 })
    })
    cookieJar.set(oauthStateCookie('google'), 'matching')
    await oauthCallback(
      new Request('https://pos.example.com/api/integrations/google/oauth/callback?state=matching&code=c1'),
      params('google'),
    )

    expect(sent).toBeInstanceOf(URLSearchParams)
    expect((sent as URLSearchParams).get('grant_type')).toBe('authorization_code')
    await expect(getCredentials('google')).resolves.toEqual({ access_token: 'at', refresh_token: 'rt' })
    const { rows } = await db().query<{ expires_at: Date }>('select expires_at from core.connections')
    expect(rows[0].expires_at.getTime()).toBeGreaterThan(Date.now() + 50 * 60_000)
  })
})

describe('oauth reconnect', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("keeps the provider's own settings, such as Google's calendar picks", async () => {
    await saveCredentials('google', { access_token: 'old', refresh_token: 'old-r', calendars: '["work"]' })
    vi.stubGlobal('fetch', async () => Response.json({ access_token: 'at', refresh_token: 'rt', expires_in: 3599 }))
    cookieJar.set(oauthStateCookie('google'), 'matching')
    await oauthCallback(
      new Request('https://pos.example.com/api/integrations/google/oauth/callback?state=matching&code=c1'),
      params('google'),
    )
    await expect(getCredentials('google')).resolves.toEqual({ access_token: 'at', refresh_token: 'rt', calendars: '["work"]' })
  })
})

describe('expiryFrom', () => {
  it('reads an absolute expires_at in seconds', () => {
    expect(expiryFrom({ access_token: 'a', expires_at: 1_800_000_000 })?.toISOString()).toBe(
      new Date(1_800_000_000_000).toISOString(),
    )
  })

  it('turns a relative expires_in into an absolute time', () => {
    const now = Date.parse('2026-09-05T00:00:00Z')
    expect(expiryFrom({ access_token: 'a', expires_in: 3600 }, now)?.toISOString()).toBe(
      '2026-09-05T01:00:00.000Z',
    )
  })

  it('returns null when the provider says nothing about expiry', () => {
    expect(expiryFrom({ access_token: 'a' })).toBeNull()
  })
})

describe('webhook route', () => {
  const url = 'https://pos.example.com/api/integrations/health_auto_export/webhook'
  const valid = { data: { metrics: [{ name: 'weight_body_mass', units: 'lb' }] } }

  const post = (body: unknown, secret?: string) =>
    webhook(
      new Request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(secret ? { [SECRET_HEADER]: secret } : {}),
        },
        body: JSON.stringify(body),
      }),
      params('health_auto_export'),
    )

  it('401s with no secret header', async () => {
    await saveCredentials('health_auto_export', { secret: 'the-real-secret' })
    expect((await post(valid)).status).toBe(401)
  })

  it('401s with the wrong secret', async () => {
    await saveCredentials('health_auto_export', { secret: 'the-real-secret' })
    expect((await post(valid, 'guessed')).status).toBe(401)
  })

  it('401s when the integration is not connected, giving nothing away', async () => {
    expect((await post(valid, 'anything')).status).toBe(401)
  })

  it('400s on a payload that does not match the schema', async () => {
    await saveCredentials('health_auto_export', { secret: 'the-real-secret' })
    const res = await post({ nonsense: true }, 'the-real-secret')
    expect(res.status).toBe(400)
  })

  it('400s on a body that is not JSON', async () => {
    await saveCredentials('health_auto_export', { secret: 'the-real-secret' })
    const res = await webhook(
      new Request(url, {
        method: 'POST',
        headers: { [SECRET_HEADER]: 'the-real-secret' },
        body: 'not json at all',
      }),
      params('health_auto_export'),
    )
    expect(res.status).toBe(400)
  })

  it('accepts a valid payload with the right secret', async () => {
    await saveCredentials('health_auto_export', { secret: 'the-real-secret' })
    const res = await post(valid, 'the-real-secret')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it('404s for an integration that is not a webhook', async () => {
    const res = await webhook(
      new Request(url, { method: 'POST', body: '{}' }),
      params('anthropic'),
    )
    expect(res.status).toBe(404)
  })

  // The dispatch line: a validated payload reaches the module that declared
  // an inbound handler for this integration id, and lands as a row.
  it('hands a valid payload to the module inbound seam', async () => {
    await saveCredentials('health_auto_export', { secret: 'the-real-secret' })
    const res = await post(
      {
        data: {
          metrics: [
            { name: 'weight_body_mass', units: 'kg', data: [{ qty: 84.5, date: '2026-09-11 07:30:00 -0500' }] },
          ],
        },
      },
      'the-real-secret',
    )
    expect(res.status).toBe(200)

    const { rows } = await db().query<{ value: string; source: string }>(
      `select value, source from fitness.body_metric where kind = 'weight' and measured_on = '2026-09-11'`,
    )
    expect(rows).toEqual([{ value: '84500', source: 'health_auto_export' }])
  })
})
