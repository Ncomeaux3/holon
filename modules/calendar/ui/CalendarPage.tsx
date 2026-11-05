import { PageHeader, SyncBand } from '@/components/pos'
import { calendarItems } from '@/core/calendar-registry'
import { getConnectionStatuses } from '@/core/credentials'
import { getModules } from '@/core/modules'
import { getSettings } from '@/core/settings'
import { syncState } from '@/core/sync'
import { ownerToday } from '@/core/today'
import { getHidden } from '../data'
import { monthRange } from '../range'
import { syncCalendar } from './actions'
import { Calendar, NewEventButton } from './Calendar'

export default async function CalendarPage() {
  const today = await ownerToday()
  const month = today.slice(0, 7)
  const [items, hidden, sync, connections, settings] = await Promise.all([
    calendarItems(monthRange(month)),
    getHidden(),
    syncState('calendar'),
    getConnectionStatuses(),
    getSettings(),
  ])
  // Once a feed has a connection row, failed or not: without one the screen is
  // complete from the other modules, and a failed pull must stay visible here.
  const feeds = [
    connections.google && 'Google',
    connections.ics && 'iCloud',
  ].filter((f): f is string => Boolean(f))
  // One feed is named; two are "Calendar feeds", because the band shares its
  // row with the avatar and "Google and iCloud" is long enough to push it onto
  // a second row at the width the band first appears.
  const band =
    feeds.length > 0 ? (
      <SyncBand
        provider={feeds.length === 1 ? feeds[0] : 'Calendar feeds'}
        at={sync.at}
        status={sync.status}
        timeZone={settings.timezone}
        onSync={syncCalendar}
      />
    ) : undefined

  // The chips: every module that dates anything, in rail order.
  const sources = getModules()
    .filter((m) => m.calendar)
    .sort((a, b) => a.nav.order - b.nav.order)
    .map((m) => ({ id: m.id, label: m.nav.label }))

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Calendar"
        title="Calendar"
        lede="Everything dated in Holon, and the events you add here."
        status={band}
        actions={<NewEventButton />}
        phoneAction={<NewEventButton phone />}
        search={false}
      />
      {/* Keyed on the last pull, so a sync remounts the grid on the rows it brought. */}
      <Calendar key={sync.at ?? ''} today={today} month={month} initial={items} hidden={hidden} sources={sources} weekStart={settings.week_start} />
    </div>
  )
}
