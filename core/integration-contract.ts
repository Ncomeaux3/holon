// The integration contract: the types and the identity function a manifest
// calls. No imports beyond types, on purpose.
//
// A manifest imports defineIntegration from here, and the registry in
// core/integrations.ts imports the manifests through integrations/_index.ts.
// Keeping the contract in its own leaf module is what stops that being a cycle,
// the same way core/module-contract.ts does for modules.

import type { ComponentType } from 'react'
import type { z } from 'zod'

// One folder, one manifest, per external account. The Connections page, the
// OAuth callback, and the webhook route are all generic and read the manifest.
// See docs/ARCHITECTURE.md "Integration contract".

export type Credentials = Record<string, string>

export type TokenField = {
  key: string
  label: string
  /** Rendered as a password field and masked once saved. */
  secret?: boolean
  placeholder?: string
}

export type IntegrationAuth =
  | { type: 'token'; fields: TokenField[] }
  | {
      type: 'oauth2'
      authorizeUrl: string
      tokenUrl: string
      scopes: string[]
      /** How the scopes are joined. Strava wants a comma (the default), Google a space. */
      scopeSeparator?: string
      /** Extra authorize parameters, such as Google's access_type=offline. */
      params?: Record<string, string>
    }
  | { type: 'webhook' }

export type TestResult = { ok: boolean; detail: string }

export type IntegrationManifest = {
  id: string
  label: string
  /** One line on the card saying what connecting this buys. */
  description: string
  auth: IntegrationAuth
  /** Runs on save and on the Test button. Must not throw. */
  test: (creds: Credentials) => Promise<TestResult>
  /**
   * Turns what the owner pasted into what should be stored, before test().
   *
   * For a credential that is exchanged once and cannot be exchanged again:
   * SimpleFIN's setup token is claimed for an access URL and a second claim of
   * the same token is refused, so storing what was typed would mean the next
   * Test press destroys a working connection. Runs on save only, never on the
   * Test button, and may throw: a failure there is a failed save.
   */
  prepare?: (creds: Credentials) => Promise<Credentials>
  /** oauth2 only. Runs nightly before module syncs. */
  refresh?: (creds: Credentials) => Promise<Credentials>
  /** webhook only. */
  webhookSchema?: z.ZodTypeAny
  webhook?: (payload: unknown) => Promise<void>
  docsUrl?: string
  /**
   * Settings rendered under the card once connected, for a choice only this
   * provider has (which Google calendars to pull). A server component, loaded
   * lazily so the registry, which the cron and MCP routes import, never pulls
   * UI into their module graph.
   */
  panel?: () => Promise<ComponentType>
}

export function defineIntegration(manifest: IntegrationManifest): IntegrationManifest {
  return manifest
}
