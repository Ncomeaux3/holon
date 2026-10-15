import { createBrowserClient } from '@supabase/ssr'
import type { Database } from './database.types'

// Separate from core/db.ts: that module reaches for next/headers, which cannot
// be bundled for the browser.

export function browserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // Passkeys are opt-in in supabase-js and every passkey method throws
        // without this flag. Supabase still calls the API experimental, so the
        // two screens that use it treat a failure as a reason to fall back to
        // the email code rather than as an error worth showing.
        experimental: { passkey: true },
      },
    },
  )
}
