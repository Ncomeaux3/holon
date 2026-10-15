import { ownerToday } from '@/core/today'
import type { CalendarItem } from '@/core/module-contract'
import { getHidden } from '../data'

export type CalendarDigest = {
  today: number
  tomorrow: number
  /** The next few things not yet done, today first. */
  next: { title: string; module: string; startsAt: string; allDay: boolean }[]
}

export async function nightlyDigest(): Promise<CalendarDigest> {
  // Dynamic for the reason core/entities.ts gives: the registry imports every
  // manifest, this one included, and a static import here is a cycle that
  // plain Node (the cron, pnpm setup, vitest) does not resolve.
  const { calendarItems } = await import('@/core/calendar-registry')
  const today = await ownerToday()
  const next = new Date(`${today}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  const tomorrow = next.toISOString().slice(0, 10)

  const hidden = new Set(await getHidden())
  const items = (await calendarItems({ from: today, to: tomorrow })).filter(
    (i) => !hidden.has(i.module),
  )
  const on = (day: string) => (i: CalendarItem) => i.startsAt.slice(0, 10) === day

  return {
    today: items.filter(on(today)).length,
    tomorrow: items.filter(on(tomorrow)).length,
    next: items
      .filter((i) => !i.done)
      .slice(0, 3)
      .map((i) => ({ title: i.title, module: i.module, startsAt: i.startsAt, allDay: i.allDay })),
  }
}
