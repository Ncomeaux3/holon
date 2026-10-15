import { z } from 'zod'
import { db } from '@/core/db'
import { defineIntegration } from '@/core/integration-contract'

// An iOS Shortcut posts the open reminders on a schedule. Apple has no
// Reminders API, and Shortcuts is the on-phone app Apple ships that can read
// them and post JSON. Inbound only, so the card shows a URL and a generated
// secret to put in the Shortcut; the Tasks module writes them through its
// inbound seam, and docs/SETUP-INTEGRATIONS.md holds the Shortcut recipe.
//
// Shortcuts sends every field as text, so the schema takes strings and the
// Tasks side reads the dates.
const payloadSchema = z.object({
  reminders: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().optional(),
      due: z.string().optional(),
      notes: z.string().optional(),
      list: z.string().optional(),
    }),
  ),
})

export default defineIntegration({
  id: 'apple_reminders',
  label: 'Apple Reminders',
  description: 'Your open reminders as tasks, posted by an iOS Shortcut you build once. Free.',
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
       where route = '/api/integrations/apple_reminders/webhook' and status = 200`,
    )
    const last = rows[0]?.last
    return last
      ? { ok: true, detail: `Last payload received ${last}.` }
      : { ok: false, detail: 'No payload yet. Build the Shortcut and run it once.' }
  },

  webhookSchema: payloadSchema,
})
