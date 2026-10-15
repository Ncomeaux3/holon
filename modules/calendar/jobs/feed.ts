import { db } from '@/core/db'

// One feed's window, written into calendar.event. Google (7a) and published
// `.ics` calendars (7b) differ in how they are read and in nothing else: both
// hand over a window of events keyed `<feed>/<id>`, both delete what the feed
// stopped returning inside it.

/** The owner's zone, as calendar/data.ts reads it. */
const TZ = `coalesce((select value #>> '{}' from core.settings where key = 'timezone'), 'UTC')`

export type FeedRow = {
  external_id: string
  calendar_name: string
  title: string
  /** An ISO timestamp with offset, or YYYY-MM-DD for an all day event. */
  starts_at: string
  ends_at: string | null
  all_day: boolean
  location: string
  url: string
  raw: unknown
}

/**
 * Upserts one feed's window and deletes what it no longer returns in it.
 * Returns how many rows were deleted.
 */
export async function storeFeed(
  source: string,
  prefix: string,
  rows: FeedRow[],
  from: Date,
  to: Date,
): Promise<number> {
  await db().query(
    `insert into calendar.event
       (source, external_id, calendar_name, title, starts_at, ends_at, all_day, location, url, raw, updated_at)
     select $2, r.external_id, r.calendar_name, r.title,
            case when r.all_day then r.starts_at::date::timestamp at time zone ${TZ} else r.starts_at::timestamptz end,
            case when r.ends_at is null then null
                 when r.all_day then r.ends_at::date::timestamp at time zone ${TZ}
                 else r.ends_at::timestamptz end,
            r.all_day, r.location, r.url, r.raw, now()
       from jsonb_to_recordset($1::jsonb) as r(
              external_id text, calendar_name text, title text, starts_at text, ends_at text,
              all_day boolean, location text, url text, raw jsonb)
     on conflict (source, external_id) do update set
       calendar_name = excluded.calendar_name, title = excluded.title,
       starts_at = excluded.starts_at, ends_at = excluded.ends_at, all_day = excluded.all_day,
       location = excluded.location, url = excluded.url, raw = excluded.raw, updated_at = now()`,
    [JSON.stringify(rows), source],
  )

  const { rowCount } = await db().query(
    `delete from calendar.event
      where source = $2 and starts_with(external_id, $1 || '/')
        and starts_at >= $3 and starts_at < $4
        and not (external_id = any($5::text[]))`,
    [prefix, source, from, to, rows.map((r) => r.external_id)],
  )
  return rowCount ?? 0
}

/** Rows of a feed whose calendar is no longer on the list. */
export async function dropFeeds(source: string, keep: string[]): Promise<number> {
  const { rowCount } = await db().query(
    `delete from calendar.event e
      where source = $2
        and not exists (select 1 from unnest($1::text[]) k where starts_with(e.external_id, k || '/'))`,
    [keep, source],
  )
  return rowCount ?? 0
}
