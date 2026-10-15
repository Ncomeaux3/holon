import { createServer, request, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  follow,
  getOnce,
  isPrivateHost,
  nextHop,
  normaliseUrl,
  pinnedLookup,
  type Fetched,
} from './fetching'

// This file is a trust boundary: `ingest` takes a URL from a server action, and
// a server action is a public POST endpoint. Everything that decides whether a
// request may leave the deployment is tested here.

describe('isPrivateHost', () => {
  it('knows the ranges a server should not be talked into fetching', () => {
    for (const host of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '0.0.0.0',
      '100.64.0.1',
      'localhost',
      'foo.localhost',
      'db.internal',
      '::1',
      'fd00::1',
      'fe80::1',
    ]) {
      expect(isPrivateHost(host), host).toBe(true)
    }
  })

  // ::ffff:127.0.0.1 is loopback wearing an IPv6 hat.
  it('is not fooled by an IPv4 mapped IPv6 address', () => {
    expect(isPrivateHost('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateHost('::ffff:169.254.169.254')).toBe(true)
  })

  it('lets normal hosts through, including the near misses', () => {
    for (const host of ['example.com', '172.32.0.1', '11.0.0.1', '192.169.1.1', '100.128.0.1']) {
      expect(isPrivateHost(host), host).toBe(false)
    }
  })
})

describe('normaliseUrl', () => {
  it('assumes https for what people actually paste', () => {
    expect(normaliseUrl('example.com/a')).toBe('https://example.com/a')
    expect(normaliseUrl('  https://example.com/a  ')).toBe('https://example.com/a')
  })

  // Testing for `https?://` and prepending otherwise turns file:///etc/passwd
  // into https://file:///etc/passwd, which parses and has protocol https:.
  it('refuses any scheme that is not http or https', () => {
    expect(() => normaliseUrl('file:///etc/passwd')).toThrow(/http/)
    expect(() => normaliseUrl('data:text/html,<b>x</b>')).toThrow(/http/)
    expect(() => normaliseUrl('gopher://example.com')).toThrow(/http/)
  })

  it('refuses a literal private address', () => {
    expect(() => normaliseUrl('http://169.254.169.254/latest/meta-data/')).toThrow(/private/)
    expect(() => normaliseUrl('http://localhost:3000/admin')).toThrow(/private/)
  })

  it('refuses something that is not a URL at all', () => {
    expect(() => normaliseUrl('   ')).toThrow()
  })
})

describe('nextHop', () => {
  it('resolves a relative Location against the current URL', () => {
    expect(nextHop('/elsewhere', 'https://example.com/deep/a')).toBe(
      'https://example.com/elsewhere',
    )
  })

  it('re-runs the address rules on the target', () => {
    expect(() => nextHop('http://169.254.169.254/', 'https://example.com/a')).toThrow(/private/)
    expect(() => nextHop('file:///etc/passwd', 'https://example.com/a')).toThrow(/http/)
  })

  it('says so when a redirect names nowhere to go', () => {
    expect(() => nextHop(null, 'https://example.com/a')).toThrow(/nowhere/)
  })
})

// The loop takes its fetcher as a parameter precisely so this can be exercised
// without a network and without loosening a check to let a test through.
describe('follow', () => {
  const page = (over: Partial<Fetched> = {}): Fetched => ({
    status: 200,
    location: null,
    contentType: 'text/html',
    body: 'ok',
    truncated: false,
    ...over,
  })

  it('follows an ordinary redirect', async () => {
    const seen: string[] = []
    const res = await follow('https://example.com/a', async (url) => {
      seen.push(url)
      return seen.length === 1
        ? page({ status: 302, location: 'https://example.com/moved' })
        : page()
    })

    expect(res.status).toBe(200)
    expect(seen).toEqual(['https://example.com/a', 'https://example.com/moved'])
  })

  // The bypass this whole design exists to stop.
  it('refuses a redirect into cloud metadata', async () => {
    await expect(
      follow('https://example.com/a', async () =>
        page({ status: 302, location: 'http://169.254.169.254/latest/meta-data/' }),
      ),
    ).rejects.toThrow(/private/)
  })

  it('gives up rather than looping forever', async () => {
    let calls = 0
    await expect(
      follow('https://example.com/a', async () => {
        calls++
        return page({ status: 302, location: 'https://example.com/next' })
      }),
    ).rejects.toThrow(/too many/)
    expect(calls).toBeLessThanOrEqual(7)
  })

  it('checks the URL it was handed before asking for it', async () => {
    const fetcher = vi.fn()
    await expect(follow('http://127.0.0.1/', fetcher)).rejects.toThrow(/private/)
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('getOnce', () => {
  const resolvingTo = (...addresses: string[]) =>
    async () => addresses.map((address) => ({ address, family: 4 }))

  // The rebinding fix. The name is resolved once, here, and the connection is
  // pinned to what came back, so a record that changes in between is never
  // consulted.
  it('refuses when the hostname resolves to a private address', async () => {
    await expect(
      getOnce('https://rebind.example/', { resolve: resolvingTo('127.0.0.1') }),
    ).rejects.toThrow(/private/)
  })

  // One private answer among several is still a way in, and which address a
  // connection picks is not ours to predict.
  it('refuses when any record is private', async () => {
    await expect(
      getOnce('https://mixed.example/', { resolve: resolvingTo('93.184.216.34', '10.0.0.1') }),
    ).rejects.toThrow(/private/)
  })

  it('refuses a host that resolves to nothing', async () => {
    await expect(getOnce('https://empty.example/', { resolve: resolvingTo() })).rejects.toThrow(
      /no addresses/,
    )
  })

  it('refuses a host that cannot be resolved at all', async () => {
    await expect(
      getOnce('https://gone.example/', {
        resolve: async () => {
          throw new Error('ENOTFOUND')
        },
      }),
    ).rejects.toThrow(/could not be found/)
  })

  it('resolves the hostname exactly once', async () => {
    const resolve = vi.fn(resolvingTo('127.0.0.1'))
    await expect(getOnce('https://x.example/', { resolve })).rejects.toThrow()
    expect(resolve).toHaveBeenCalledTimes(1)
  })
})

// Proves node honours the `lookup` we hand it, which is the mechanism the
// rebinding fix rests on. Without this the rest is an assumption.
describe('pinnedLookup, against a real server', () => {
  let server: Server
  let port = 0

  beforeAll(async () => {
    server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(`host=${req.headers.host}`)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    port = (server.address() as { port: number }).port
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  it('sends the connection to the pinned address, whatever the hostname says', async () => {
    const body = await new Promise<string>((resolve, reject) => {
      const req = request(
        {
          protocol: 'http:',
          // A name that does not resolve to the test server, or to anything.
          hostname: 'pinned.example',
          port,
          path: '/',
          lookup: pinnedLookup([{ address: '127.0.0.1', family: 4 }]),
        },
        (res) => {
          let text = ''
          res.on('data', (c) => (text += c))
          res.on('end', () => resolve(text))
        },
      )
      req.on('error', reject)
      req.end()
    })

    // Connected to the pinned address, and the Host header still carries the
    // hostname, so virtual hosting and TLS certificate names are unaffected.
    expect(body).toBe(`host=pinned.example:${port}`)
  })

  it('reports an error rather than falling back when there is nothing to pin to', async () => {
    const lookup = pinnedLookup([])
    const err = await new Promise<Error | null>((resolve) => {
      ;(lookup as unknown as (h: string, o: object, cb: (e: Error | null) => void) => void)(
        'anything.example',
        {},
        (e) => resolve(e),
      )
    })
    expect(err).toBeInstanceOf(Error)
  })
})
