import { beforeEach, describe, expect, it } from 'vitest'
import { check, hashIp, reset, tooManyRequests } from './ratelimit'

beforeEach(() => reset())

describe('check', () => {
  it('allows sixty calls in a window and refuses the sixty first', () => {
    for (let i = 0; i < 60; i++) {
      expect(check('a').ok, `call ${i + 1}`).toBe(true)
    }
    expect(check('a').ok).toBe(false)
  })

  it('counts each caller separately', () => {
    for (let i = 0; i < 60; i++) check('a')
    expect(check('a').ok).toBe(false)
    expect(check('b').ok).toBe(true)
  })

  it('lets the caller back in once the window has passed', () => {
    const start = 1_000_000
    for (let i = 0; i < 60; i++) check('a', start)
    expect(check('a', start).ok).toBe(false)
    expect(check('a', start + 60_001).ok).toBe(true)
  })

  it('says how long to wait, based on the oldest call still in the window', () => {
    const start = 1_000_000
    for (let i = 0; i < 60; i++) check('a', start)

    const verdict = check('a', start + 20_000)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      // 60s window, 20s elapsed, so about 40 left.
      expect(verdict.retryAfterSeconds).toBe(40)
    }
  })

  it('never advises waiting zero seconds', () => {
    const start = 1_000_000
    for (let i = 0; i < 60; i++) check('a', start)
    const verdict = check('a', start + 59_999)
    if (!verdict.ok) expect(verdict.retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })
})

describe('hashIp', () => {
  it('is stable and does not carry the address', () => {
    expect(hashIp('203.0.113.9')).toBe(hashIp('203.0.113.9'))
    expect(hashIp('203.0.113.9')).not.toContain('203')
  })

  it('separates different addresses', () => {
    expect(hashIp('203.0.113.9')).not.toBe(hashIp('203.0.113.10'))
  })
})

describe('tooManyRequests', () => {
  it('is a 429 carrying retry-after', async () => {
    const response = tooManyRequests(30)
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('30')
    await expect(response.json()).resolves.toHaveProperty('error')
  })
})
