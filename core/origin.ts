import { headers } from 'next/headers'

/**
 * The public origin of this install, for URLs the owner has to paste somewhere
 * else: webhook endpoints, the MCP command, magic link redirects.
 *
 * `origin` is only sent on cross-origin requests and form posts, so a plain GET
 * render sees null and would otherwise print a relative path into a webhook
 * URL. `host` is always there, and behind Vercel `x-forwarded-proto` says
 * whether it is https.
 */
export async function getOrigin(): Promise<string> {
  const h = await headers()

  const explicit = h.get('origin')
  if (explicit) return explicit

  const host = h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}
