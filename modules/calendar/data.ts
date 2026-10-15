import { db } from '@/core/db'
import type { CalendarItem } from '@/core/module-contract'

// Reads and writes over calendar.event and calendar.settings. The other
// modules' dated rows never come through here: they arrive through the
// `calendar` seam, composed by core/calendar-registry.ts.

/** The owner's zone, in SQL, the same fallback core.today() uses. */
const TZ = `coalesce((select value #>> '{}' from core.settings where key = 'timezone'), 'UTC')`

export type EventRow = {
  id: string
  source: string
  calendar_name: string
  title: string
  /** YYYY-MM-DD in the owner's zone. */
  on_date: string
  /** HH:MM in the owner's zone; null for an all-day event. */
  starts: string | null
  ends: string | null
  end_date: string | null
  all_day: boolean
  location: string
}

export async function listEvents(range: { from: string; to: string }): Promise<EventRow[]> {
  const { rows } = await db().query<EventRow>(
    `select id, source, calendar_name, title, location, all_day,
            to_char(starts_at at time zone ${TZ}, 'YYYY-MM-DD') as on_date,
            case when all_day then null else to_char(starts_at at time zone ${TZ}, 'HH24:MI') end as starts,
            case when all_day or ends_at is null then null
                 else to_char(ends_at at time zone ${TZ}, 'HH24:MI') end as ends,
            to_char(ends_at at time zone ${TZ}, 'YYYY-MM-DD') as end_date
       from calendar.event
      where (starts_at at time zone ${TZ})::date between $1::date and $2::date
      order by starts_at`,
    [range.from, range.to],
  )
  return rows
}

export function toItems(rows: EventRow[]): CalendarItem[] {
  return rows.map((r) => ({
    id: r.id,
    module: 'calendar',
    title: r.title,
    ...(r.location && { meta: r.location }),
    startsAt: r.all_day || !r.starts ? r.on_date : `${r.on_date}T${r.starts}`,
    ...(r.ends && r.end_date && { endsAt: `${r.end_date}T${r.ends}` }),
    allDay: r.all_day,
    href: `/calendar?event=${r.id}`,
    // A typed event is editable on the screen; a feed's is read only.
    kind: r.source === 'manual' || r.source === 'agent' ? 'event' : 'feed',
  }))
}

export type EventInput = {
  id?: string
  title: string
  on_date: string
  all_day: boolean
  starts?: string | null
  ends?: string | null
  location?: string
}

/**
 * Insert or update one typed event. The wall-clock date and times are turned
 * into instants in SQL, in the owner's zone, so the server's own zone (UTC on
 * Vercel) never enters it. An update is refused on anything not typed by the
 * owner: a feed's rows are its own and the next pull would overwrite them.
 */
export async function writeEvent(input: EventInput, source: 'manual' | 'agent'): Promise<string> {
  const values = [
    input.title,
    input.on_date,
    input.all_day,
    input.all_day ? null : (input.starts ?? null),
    input.all_day ? null : (input.ends ?? null),
    input.location ?? '',
  ]
  const starts = `(($2::date + coalesce($4::time, '00:00')) at time zone ${TZ})`
  const ends = `case when $5::time is null then null else (($2::date + $5::time) at time zone ${TZ}) end`

  if (input.id) {
    const { rows } = await db().query<{ id: string }>(
      `update calendar.event
          set title = $1, starts_at = ${starts}, ends_at = ${ends}, all_day = $3, location = $6
        where id = $7 and source in ('manual', 'agent')
        returning id`,
      [...values, input.id],
    )
    if (rows.length === 0) throw new Error('Only an event typed here can be edited')
    return rows[0].id
  }

  const { rows } = await db().query<{ id: string }>(
    `insert into calendar.event (source, title, starts_at, ends_at, all_day, location)
     values ($7, $1, ${starts}, ${ends}, $3, $6)
     returning id`,
    [...values, source],
  )
  return rows[0].id
}

export async function deleteEvent(id: string): Promise<void> {
  const { rowCount } = await db().query(
    `delete from calendar.event where id = $1 and source in ('manual', 'agent')`,
    [id],
  )
  if (!rowCount) throw new Error('Only an event typed here can be deleted')
}

export async function getHidden(): Promise<string[]> {
  const { rows } = await db().query<{ hidden: string[] }>(`select hidden from calendar.settings`)
  return rows[0]?.hidden ?? []
}

export async function setHidden(hidden: string[]): Promise<void> {
  await db().query(`update calendar.settings set hidden = $1`, [hidden])
}
