/** One state cookie per provider, so two flows cannot clobber each other. */
export function oauthStateCookie(integrationId: string): string {
  return `pos_oauth_state_${integrationId}`
}

export type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_at?: number
  expires_in?: number
}

/**
 * Providers disagree on whether they return an absolute expiry or a lifetime.
 * Pure so the ambiguity is tested rather than discovered in production.
 */
export function expiryFrom(token: TokenResponse, now = Date.now()): Date | null {
  if (typeof token.expires_at === 'number') return new Date(token.expires_at * 1000)
  if (typeof token.expires_in === 'number') return new Date(now + token.expires_in * 1000)
  return null
}
