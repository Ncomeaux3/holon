import { recordError } from './log'
import { getModules } from './modules'
import type { CalendarItem } from './module-contract'

// Every installed module's dated rows for a range, for the Calendar screen.
// Core names no module: a module with no `calendar` seam contributes nothing.

export async function calendarItems(range: { from: string; to: string }): Promise<CalendarItem[]> {
  const out = await Promise.all(
    getModules().map(async (manifest) => {
      if (!manifest.calendar) return []
      try {
        return await manifest.calendar(range)
      } catch (error) {
        // Left out rather than failing the month; the reason goes to the Errors tab.
        await recordError(`calendar:${manifest.id}`, error)
        return []
      }
    }),
  )

  return out.flat().sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}
