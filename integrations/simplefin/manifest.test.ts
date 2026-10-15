import { afterEach, expect, it, vi } from 'vitest'

import manifest from './manifest'

// A SimpleFIN setup token can be claimed exactly once. Everything here is about
// that fact: the claim happens on save, in prepare(), and the access URL is
// what gets stored, so pressing Test afterwards never consumes anything.

afterEach(() => vi.unstubAllGlobals())

const token = Buffer.from('https://bridge.simplefin.org/claim/abc123').toString('base64')

it('claims a setup token and stores the access URL instead', async () => {
  const fetchMock = vi.fn(
    async (_url: unknown, init?: RequestInit) =>
      new Response(`https://u:p@bridge.simplefin.org/simplefin${init?.method === 'POST' ? '' : '-not-a-post'}`),
  )
  vi.stubGlobal('fetch', fetchMock)

  const prepared = await manifest.prepare!({ access_url: token })

  // The claim is a POST. A GET to a claim URL returns the claim page, not a
  // credential, so the method is part of what makes this correct.
  expect(prepared.access_url).toBe('https://u:p@bridge.simplefin.org/simplefin')
  expect(fetchMock).toHaveBeenCalledOnce()
})

// The important one. If prepare() ran again on an access URL it would POST to
// the bridge as though it were a claim URL, and the owner would lose a
// connection by pressing Save twice.
it('leaves an access URL alone, so saving twice is safe', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)

  const url = 'https://u:p@bridge.simplefin.org/simplefin'
  const prepared = await manifest.prepare!({ access_url: url })

  expect(prepared.access_url).toBe(url)
  expect(fetchMock).not.toHaveBeenCalled()
})

it('leaves a blank alone, because blank means keep what is stored', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)

  await manifest.prepare!({ access_url: '' })

  expect(fetchMock).not.toHaveBeenCalled()
})

// Test runs on every press of the button, so it must never claim.
it('never claims from test, whatever it is given', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)

  const result = await manifest.test({ access_url: token })

  expect(result.ok).toBe(false)
  expect(result.detail).toContain('No access URL stored')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('says the subscription lapsed rather than that the URL is wrong', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 402 })))

  const result = await manifest.test({ access_url: 'https://u:p@bridge.simplefin.org/simplefin' })

  expect(result.ok).toBe(false)
  expect(result.detail).toContain('payment')
})

// A bridge that answers with no accounts is connected but useless, and saying
// "connected" there would send the owner looking at the wrong thing later.
it('does not call an empty account set a working connection', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ accounts: [], errlist: [] })),
  )

  const result = await manifest.test({ access_url: 'https://u:p@bridge.simplefin.org/simplefin' })

  expect(result.ok).toBe(false)
  expect(result.detail).toContain('no accounts')
})

it('reports the accounts it found', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        accounts: [
          {
            id: 'a1',
            name: 'Northwind Total Checking',
            currency: 'USD',
            balance: '1240.55',
            'balance-date': 1757000000,
          },
        ],
      }),
    ),
  )

  const result = await manifest.test({ access_url: 'https://u:p@bridge.simplefin.org/simplefin' })

  expect(result.ok).toBe(true)
  expect(result.detail).toContain('Northwind Total Checking')
})
