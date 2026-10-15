import { randomBytes } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import {
  deleteCredentials,
  freshCredentials,
  getCredentials,
  getIntegration,
  getIntegrations,
  saveCredentials,
  stateMatches,
} from './integrations'
import { getModules } from './modules'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

beforeEach(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64')
})
afterEach(async () => {
  await db().query('delete from core.connections')
})
afterAll(async () => {
  await db().end()
})

describe('the integration registry', () => {
  const integrations = getIntegrations()

  it('has every provider the architecture lists for day one', () => {
    expect(integrations.map((i) => i.id).sort()).toEqual([
      'anthropic',
      'apple_reminders',
      'apple_shortcuts',
      'github_vault',
      'google',
      'health_auto_export',
      'ics',
      'resend',
      'simplefin',
      'strava',
      'usda',
      'voyage',
    ])
  })

  it('gives every integration a unique id that is a valid identifier', () => {
    const ids = integrations.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9_]*$/)
  })

  it('gives every integration a label and a test function', () => {
    for (const i of integrations) {
      expect(i.label, i.id).toBeTruthy()
      expect(typeof i.test, i.id).toBe('function')
    }
  })

  it('gives every integration a valid auth block for its type', () => {
    for (const i of integrations) {
      expect(['token', 'oauth2', 'webhook'], i.id).toContain(i.auth.type)

      if (i.auth.type === 'token') {
        expect(i.auth.fields.length, i.id).toBeGreaterThan(0)
        for (const f of i.auth.fields) {
          expect(f.key, i.id).toMatch(/^[a-z][a-z0-9_]*$/)
          expect(f.label, i.id).toBeTruthy()
        }
      }

      if (i.auth.type === 'oauth2') {
        expect(i.auth.authorizeUrl, i.id).toMatch(/^https:\/\//)
        expect(i.auth.tokenUrl, i.id).toMatch(/^https:\/\//)
        // oauth2 tokens expire, so a refresh path is not optional.
        expect(typeof i.refresh, i.id).toBe('function')
      }

      if (i.auth.type === 'webhook') {
        // Inbound only: something has to validate the payload, and something
        // has to consume it, either the manifest itself or a module's inbound
        // seam for this id. A webhook nobody reads is a 200 that lies.
        expect(i.webhookSchema, i.id).toBeDefined()
        const consumed =
          typeof i.webhook === 'function' ||
          getModules().some((m) => typeof m.inbound?.[i.id] === 'function')
        expect(consumed, i.id).toBe(true)
      }
    }
  })
})

describe('credentials', () => {
  it('round trips through encryption', async () => {
    await saveCredentials('anthropic', { api_key: 'sk-ant-secret-value' })
    await expect(getCredentials('anthropic')).resolves.toEqual({ api_key: 'sk-ant-secret-value' })
  })

  it('never stores the plaintext', async () => {
    await saveCredentials('anthropic', { api_key: 'sk-ant-secret-value' })
    const { rows } = await db().query<{ credentials_encrypted: string }>(
      'select credentials_encrypted from core.connections',
    )
    expect(rows[0].credentials_encrypted).not.toContain('sk-ant-secret-value')
    expect(rows[0].credentials_encrypted.split(':')).toHaveLength(3)
  })

  it('returns null when nothing is connected', async () => {
    await expect(getCredentials('voyage')).resolves.toBeNull()
  })

  it('replaces rather than duplicating on reconnect', async () => {
    await saveCredentials('anthropic', { api_key: 'first' })
    await saveCredentials('anthropic', { api_key: 'second' })
    await expect(getCredentials('anthropic')).resolves.toEqual({ api_key: 'second' })
    const { rows } = await db().query('select count(*)::int as n from core.connections')
    expect(rows[0].n).toBe(1)
  })

  it('forgets the row entirely on disconnect', async () => {
    await saveCredentials('anthropic', { api_key: 'x' })
    await deleteCredentials('anthropic')
    await expect(getCredentials('anthropic')).resolves.toBeNull()
    const { rows } = await db().query('select count(*)::int as n from core.connections')
    expect(rows[0].n).toBe(0)
  })

  // Rotating ENCRYPTION_KEY must fail loudly, not hand back garbage.
  it('throws rather than returning junk when the key changed', async () => {
    await saveCredentials('anthropic', { api_key: 'x' })
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64')
    await expect(getCredentials('anthropic')).rejects.toThrow()
  })
})

describe('freshCredentials', () => {
  const inAMinute = () => new Date(Date.now() + 60_000)
  const refresh = async () => ({ access_token: 'new', expires_at: String(Math.floor(Date.now() / 1000) + 3600) })

  it('refreshes a token about to lapse, keeping the refresh token and the other fields', async () => {
    await saveCredentials('google', { access_token: 'old', refresh_token: 'r', calendars: '["a"]' }, { expiresAt: inAMinute() })
    await expect(freshCredentials('google', refresh)).resolves.toEqual({
      access_token: 'new',
      refresh_token: 'r',
      calendars: '["a"]',
      expires_at: expect.any(String),
    })
    await expect(getCredentials('google')).resolves.toMatchObject({ access_token: 'new', refresh_token: 'r' })
    const { rows } = await db().query<{ expires_at: Date }>('select expires_at from core.connections')
    expect(rows[0].expires_at.getTime()).toBeGreaterThan(Date.now() + 30 * 60_000)
  })

  it('leaves a token with time to spare alone', async () => {
    await saveCredentials('google', { access_token: 'old', refresh_token: 'r' }, { expiresAt: new Date(Date.now() + 3_600_000) })
    await expect(freshCredentials('google', refresh)).resolves.toMatchObject({ access_token: 'old' })
  })

  // The Test button saves without an expiry; that must not switch refresh off.
  it('keeps the stored expiry when a later save has none', async () => {
    await saveCredentials('google', { access_token: 'old', refresh_token: 'r' }, { expiresAt: inAMinute() })
    await saveCredentials('google', { access_token: 'old', refresh_token: 'r' }, { testDetail: 'ok' })
    await expect(freshCredentials('google', refresh)).resolves.toMatchObject({ access_token: 'new' })
  })
})

describe('stateMatches', () => {
  // OAuth CSRF: the state in the callback has to equal the one we set as a cookie.
  it('accepts only an exact, non empty match', () => {
    expect(stateMatches('abc123', 'abc123')).toBe(true)
    expect(stateMatches('abc123', 'different')).toBe(false)
  })

  it('rejects a missing state on either side, rather than matching empty to empty', () => {
    expect(stateMatches(null, 'abc123')).toBe(false)
    expect(stateMatches('abc123', null)).toBe(false)
    expect(stateMatches(null, null)).toBe(false)
    expect(stateMatches('', '')).toBe(false)
  })
})

describe('manifest test functions', () => {
  it('reports a clear failure rather than throwing when a provider rejects the key', async () => {
    const anthropic = getIntegration('anthropic')!
    const result = await anthropic.test({ api_key: 'sk-ant-definitely-invalid' })
    expect(result.ok).toBe(false)
    expect(result.detail).toBeTruthy()
  })
})
