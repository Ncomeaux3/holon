import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { LookupFunction } from 'node:net'

// How this module talks to the outside, and every check on the way out.
//
// It is its own file because it is a trust boundary: `ingest` takes a URL from
// a server action, and a server action is a public POST endpoint. Everything
// that decides whether a request is allowed to leave lives here, and nothing
// here knows what a note is.
//
// `fetch` is deliberately not used. Node's fetch cannot pin a connection to an
// address, and without pinning the hostname is resolved once for the check and
// again for the connection, which is a window a DNS record with a short TTL
// fits through. `node:https` takes a `lookup`, so the address that was checked
// is the address that is dialled.

export class Refused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Refused'
  }
}

/**
 * Addresses a server must not be talked into fetching.
 *
 * Literal forms only, and pure, which is what lets it run over a resolved IP as
 * well as over a URL's hostname. Both callers below use it for exactly that.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true
  // IPv6 loopback, unique local, link local.
  if (host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return true
  // IPv4 mapped IPv6, so ::ffff:127.0.0.1 is not a way around the rules below.
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1]

  const octets = (mapped ?? host).split('.')
  if (octets.length !== 4 || !octets.every((o) => /^\d{1,3}$/.test(o))) return false
  const [a, b] = octets.map(Number)
  if (octets.some((o) => Number(o) > 255)) return false

  return (
    a === 0 || // this network
    a === 10 || // private
    a === 127 || // loopback
    (a === 169 && b === 254) || // link local, and cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 100 && b >= 64 && b <= 127) // carrier grade NAT
  )
}

/**
 * A pasted URL, tidied, with the checks that need no network.
 *
 * A bare `example.com/x` is what people paste, and `new URL` rejects it, so
 * https is assumed rather than the paste being refused.
 */
export function normaliseUrl(input: string): string {
  const trimmed = input.trim()

  // Any scheme at all has to be one of the two allowed. Testing for `https?://`
  // and prepending otherwise is the obvious version and it is wrong: it turns
  // `file:///etc/passwd` into `https://file:///etc/passwd`, which parses, has
  // protocol `https:`, and sails straight through the check below.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) {
    throw new Refused('Only http and https URLs can be read.')
  }

  let parsed: URL
  try {
    parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
  } catch {
    throw new Refused(`That does not look like a URL: ${input}`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Refused('Only http and https URLs can be read.')
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Refused('That address is on a private network, so it will not be fetched.')
  }
  return parsed.toString()
}

export type Address = { address: string; family: number }

/**
 * A resolver, so a test can say what a name resolves to.
 *
 * Defaulted rather than injected everywhere: production never passes one.
 */
export type Resolver = (hostname: string) => Promise<Address[]>

const systemResolver: Resolver = async (hostname) => {
  const { lookup } = await import('node:dns/promises')
  return lookup(hostname, { all: true })
}

/**
 * A `lookup` that answers with addresses that were already checked.
 *
 * This is the whole of the rebinding fix. Node calls it instead of resolving,
 * so the address the guard approved is the address the socket connects to, and
 * a record that changes in between is never consulted. The hostname argument is
 * ignored on purpose: answering anything else would reopen the window.
 */
export function pinnedLookup(addresses: Address[]): LookupFunction {
  return ((hostname, options, callback) => {
    // node:net calls this in two shapes depending on the `all` option.
    const cb = (typeof options === 'function' ? options : callback) as (
      err: Error | null,
      address: string | Address[],
      family?: number,
    ) => void
    const wantsAll = typeof options === 'object' && options !== null && options.all === true

    if (addresses.length === 0) {
      cb(new Error(`No allowed address for ${hostname}`), '')
      return
    }
    if (wantsAll) cb(null, addresses)
    else cb(null, addresses[0].address, addresses[0].family)
  }) as LookupFunction
}

export type Fetched = {
  status: number
  /** Present only on a 3xx, and never followed by this function. */
  location: string | null
  contentType: string
  body: string
  /** True when the body hit the byte cap and was cut. */
  truncated: boolean
}

export type GetOptions = {
  headers?: Record<string, string>
  maxBytes?: number
  timeoutMs?: number
  resolve?: Resolver
}

/**
 * One request, to an address that was checked, over a connection pinned to it.
 *
 * Redirects are returned rather than followed: the caller re-checks the target
 * before asking for it, which is what stops a redirect being a way past the
 * address rules.
 */
export async function getOnce(url: string, options: GetOptions = {}): Promise<Fetched> {
  const { headers = {}, maxBytes = 5_000_000, timeoutMs = 30_000 } = options
  const parsed = new URL(normaliseUrl(url))

  const resolver = options.resolve ?? systemResolver
  let addresses: Address[]
  try {
    addresses = await resolver(parsed.hostname)
  } catch {
    // An unresolvable host is not an attack. Letting it through means the
    // request fails next with a better message than this could give, and the
    // pinned lookup below then has nothing to answer with.
    throw new Refused(`That host could not be found: ${parsed.hostname}`)
  }

  // Every record, not the first: one private answer among several is still a
  // way in, and which one a connection picks is not ours to predict.
  const bad = addresses.find((a) => isPrivateHost(a.address))
  if (bad) {
    throw new Refused('That address is on a private network, so it will not be fetched.')
  }
  if (addresses.length === 0) {
    throw new Refused(`That host resolved to no addresses: ${parsed.hostname}`)
  }

  const send = parsed.protocol === 'https:' ? httpsRequest : httpRequest

  return new Promise<Fetched>((resolve, reject) => {
    const req = send(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers,
        // The pin. Node dials one of these rather than resolving again, and
        // `hostname` above still drives the Host header and the TLS name, so
        // virtual hosting and certificate validation are unaffected.
        lookup: pinnedLookup(addresses),
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        let truncated = false

        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > maxBytes) {
            truncated = true
            res.destroy()
            return
          }
          chunks.push(chunk)
        })

        const finish = () =>
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location ?? null,
            contentType: String(res.headers['content-type'] ?? ''),
            body: Buffer.concat(chunks).toString('utf8'),
            truncated,
          })

        res.on('end', finish)
        // destroy() after the cap ends the stream without 'end', and the body
        // read so far is still the answer.
        res.on('close', finish)
        res.on('error', reject)
      },
    )

    req.on('timeout', () => {
      req.destroy(new Error('That page took too long to answer.'))
    })
    req.on('error', reject)
    req.end()
  })
}

/** Hops before giving up. Five is more than any real article needs. */
export const MAX_REDIRECTS = 5

/**
 * Where a redirect actually points, checked.
 *
 * Pure, and separate from the request, because this is the rule a redirect
 * bypass turns on: a `Location` may be relative, and resolving it against the
 * wrong base or skipping the address rules is how a 302 becomes a way into the
 * private network. Throws rather than returning null so the reason survives.
 */
export function nextHop(location: string | null, currentUrl: string): string {
  if (!location) throw new Refused('That page redirected to nowhere.')
  let absolute: string
  try {
    absolute = new URL(location, currentUrl).toString()
  } catch {
    throw new Refused('That page redirected somewhere unreadable.')
  }
  // Re-runs the scheme and literal address rules on the target.
  return normaliseUrl(absolute)
}

/**
 * Follow redirects by hand, checking every hop.
 *
 * `fetch`'s own following would check the URL the owner pasted and nothing
 * after it, so a page under someone else's control answering `302 Location:
 * http://169.254.169.254/latest/meta-data/` would be fetched from inside the
 * deployment with the guard already satisfied.
 *
 * The fetcher is a parameter so this loop can be exercised without a network
 * and without loosening any check to let a test through. `get` supplies the
 * real one.
 */
export async function follow(
  url: string,
  fetchOnce: (url: string) => Promise<Fetched>,
): Promise<Fetched> {
  let current = normaliseUrl(url)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchOnce(current)
    if (res.status < 300 || res.status >= 400) return res
    current = nextHop(res.location, current)
  }

  throw new Refused('That link redirected too many times.')
}

/** What callers use: the real request, with every hop checked. */
export function get(url: string, options: GetOptions = {}): Promise<Fetched> {
  return follow(url, (next) => getOnce(next, options))
}
