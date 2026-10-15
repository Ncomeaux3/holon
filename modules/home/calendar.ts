import type { CalendarItem } from '@/core/module-contract'
import { listServices, listWarranties, toSchedule } from './data'
import { addMonths, nextDue, type Service } from './schedule'

// What Home puts on the Calendar: a service's next occurrence, then its
// following ones walked forward by its interval as far as the range asks.
// A service with no interval shows only the one occurrence nextDue() finds.

export type ServiceForCalendar = Service & { id: string; asset_id: string; title: string }

export function toCalendarItems(
  services: ServiceForCalendar[],
  range: { from: string; to: string },
): CalendarItem[] {
  const items: CalendarItem[] = []

  for (const s of services) {
    let date = nextDue(s)
    if (!date) continue

    let projected = false
    while (date <= range.to) {
      if (date >= range.from) {
        items.push({
          id: `${s.id}:${date}`,
          module: 'home',
          title: s.title,
          startsAt: date,
          allDay: true,
          href: `/home?asset=${s.asset_id}`,
          kind: 'service',
          projected,
        })
      }
      if (s.intervalMonths <= 0) break
      date = addMonths(date, s.intervalMonths)
      projected = true
    }
  }

  return items
}

/** Cover running out, on the day it ends. A warranty with no end date never shows. */
export function warrantyItems(
  warranties: { id: string; name: string; expiresOn: string | null }[],
  range: { from: string; to: string },
): CalendarItem[] {
  return warranties
    .filter((w) => w.expiresOn !== null && w.expiresOn >= range.from && w.expiresOn <= range.to)
    .map((w) => ({
      id: `warranty:${w.id}`,
      module: 'home',
      title: `${w.name} ends`,
      startsAt: w.expiresOn!,
      allDay: true,
      href: `/home?warranty=${w.id}`,
      kind: 'warranty',
    }))
}

export async function calendarFor(range: { from: string; to: string }): Promise<CalendarItem[]> {
  const [services, warranties] = await Promise.all([listServices(), listWarranties()])
  return [
    ...toCalendarItems(
      services.map((s) => ({ id: s.id, asset_id: s.asset_id, title: s.title, ...toSchedule(s) })),
      range,
    ),
    ...warrantyItems(
      warranties.map((w) => ({ id: w.id, name: w.name, expiresOn: w.expires_on })),
      range,
    ),
  ]
}
