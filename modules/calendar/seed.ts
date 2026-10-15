import { db } from '@/core/db'

// Synthetic events for `pnpm setup --demo`, dated from today so the grid is
// never empty in a fresh demo. Upserts on external_id, so a rerun moves them
// rather than duplicating them. Invented, like every seed in the template.

const TZ = `coalesce((select value #>> '{}' from core.settings where key = 'timezone'), 'UTC')`

const EVENTS: {
  external_id: string
  title: string
  days: number
  time: string | null
  location: string
  /** The feed's own calendar name, where the row stands in for a feed's. */
  calendar_name?: string
}[] = [
  { external_id: 'e-coffee', title: 'Coffee with Rowan', days: 1, time: '08:30', location: 'Corner cafe' },
  { external_id: 'e-birthday', title: "Priya's birthday", days: 4, time: null, location: '' },
  { external_id: 'e-plumber', title: 'Plumber window', days: 9, time: '13:00', location: 'Home' },
  // Stands in for a subscribed calendar's event: it sits on its day under the
  // calendar's name and does not open the editor, which is how every source
  // but `manual` and `agent` renders. Left as `demo` rather than `ics` on
  // purpose, so the nightly `pull_ics` does not delete it as a row from a
  // calendar no longer on the list.
  {
    external_id: 'demo-feed/school-play',
    title: 'School play',
    days: 6,
    time: '18:00',
    location: 'Auditorium',
    calendar_name: 'Family',
  },
]

export async function seed(): Promise<number> {
  for (const e of EVENTS) {
    await db().query(
      `insert into calendar.event (source, external_id, title, calendar_name, starts_at, ends_at, all_day, location)
       values ('demo', $1, $2, coalesce($6, ''),
               ((core.today() + $3::int) + coalesce($4::time, '00:00')) at time zone ${TZ},
               case when $4::time is null then null
                    else ((core.today() + $3::int) + $4::time + interval '1 hour') at time zone ${TZ} end,
               $4::time is null, $5)
       on conflict (source, external_id) do update
         set title = excluded.title, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
             all_day = excluded.all_day, location = excluded.location,
             calendar_name = excluded.calendar_name`,
      [e.external_id, e.title, e.days, e.time, e.location, e.calendar_name ?? null],
    )
  }
  return EVENTS.length
}
