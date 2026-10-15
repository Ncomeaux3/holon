import { z } from 'zod'
import { db } from '@/core/db'
import { defineIntegration } from '@/core/integration-contract'

// An iOS Shortcut posts Apple Health data on a Personal Automation schedule.
// The free route: Apple Health is readable only on the phone, and Shortcuts
// is the on-phone app Apple ships that can read it and post JSON. Inbound
// only, so the card shows a URL and a generated secret to put in the
// Shortcut. The Fitness module consumes the payload through its inbound
// seam; client.ts holds the translation, docs/SETUP-INTEGRATIONS.md the
// Shortcut recipe.
const payloadSchema = z.object({
  day: z.string(),
  metrics: z.record(z.string(), z.unknown()).optional(),
  workouts: z.array(z.record(z.string(), z.unknown())).optional(),
})

export default defineIntegration({
  id: 'apple_shortcuts',
  label: 'Apple Health (Shortcuts)',
  description: 'Apple Health workouts and readings, posted by an iOS Shortcut you build once. Free.',
  docsUrl: 'https://support.apple.com/guide/shortcuts/welcome/ios',

  auth: { type: 'webhook' },

  // Nothing to call, so the test is whether anything has ever called us: the
  // request log keeps every hit on the webhook route, and a 200 is a payload
  // that passed the secret and the schema.
  test: async () => {
    const { rows } = await db().query<{ last: string | null }>(
      `select to_char(
         max(occurred_at) at time zone coalesce(
           (select value #>> '{}' from core.settings where key = 'timezone'), 'UTC'),
         'YYYY-MM-DD HH24:MI') as last
       from core.request_log
       where route = '/api/integrations/apple_shortcuts/webhook' and status = 200`,
    )
    const last = rows[0]?.last
    return last
      ? { ok: true, detail: `Last payload received ${last}.` }
      : { ok: false, detail: 'No payload yet. Build the Shortcut and run it once.' }
  },

  webhookSchema: payloadSchema,
})
