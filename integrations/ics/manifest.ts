import { defineIntegration } from '@/core/integration-contract'
import { getSetting } from '@/core/settings'
import { fetchIcs, feedUrls, httpUrl, parseIcs, pullWindow } from './client'

// A published calendar, by its own URL. Apple has no Calendar API, and a
// private iCloud calendar needs CalDAV and an app specific password; a
// calendar published from Calendar.app is a plain `.ics` file over https,
// which is the whole of this integration.
//
// One URL is pasted to connect; the panel under the card holds the rest, the
// way Google's calendar picker does. A URL list needs no migration and leaves
// with a disconnect.

export default defineIntegration({
  id: 'ics',
  label: 'iCloud and other calendars',
  description: 'A published calendar by its webcal or https URL, read only, on the Calendar screen.',
  docsUrl: 'https://support.apple.com/guide/calendar/share-calendars-icl1002/mac',

  auth: {
    type: 'token',
    fields: [
      {
        key: 'urls',
        label: 'Calendar URL',
        placeholder: 'webcal://p01-calendars.icloud.com/published/2/...',
      },
    ],
  },

  // Saved as a list from the first paste, so the panel and the pull read one
  // shape. Runs on save only, and a URL that answers with something other than
  // a calendar is a failed save rather than a feed that pulls nothing.
  prepare: async (creds) => {
    const urls = feedUrls(creds)
    if (urls.length === 0) throw new Error('Paste the calendar URL from Calendar.app.')
    return { ...creds, urls: JSON.stringify(urls.map(httpUrl)) }
  },

  test: async (creds) => {
    const urls = feedUrls(creds)
    if (urls.length === 0) return { ok: false, detail: 'No calendar URL yet.' }

    // The same window the pull reads, so the count is the count that will land.
    const window = { ...pullWindow(), zone: await getSetting('timezone') }
    const seen: string[] = []
    for (const url of urls) {
      try {
        const calendar = parseIcs(await fetchIcs(url), window)
        seen.push(`${calendar.name || 'Unnamed'} (${calendar.events.length})`)
      } catch (error) {
        return { ok: false, detail: `${url}: ${error instanceof Error ? error.message : 'did not answer.'}` }
      }
    }
    return { ok: true, detail: `${urls.length} calendars, events in each: ${seen.join(', ')}.` }
  },

  panel: async () => (await import('./ui/Feeds')).Feeds,
})
