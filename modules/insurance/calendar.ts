import { db } from '@/core/db'
import type { CalendarItem } from '@/core/module-contract'

// What Insurance puts on the Calendar: an active policy's expiry date.

export type PolicyRow = {
  id: string
  name: string
  expires_on: string | null
  status: string
}

export function toCalendarItems(rows: PolicyRow[], range: { from: string; to: string }): CalendarItem[] {
  return rows
    .filter(
      (r): r is PolicyRow & { expires_on: string } =>
        r.status === 'active' &&
        r.expires_on !== null &&
        r.expires_on >= range.from &&
        r.expires_on <= range.to,
    )
    .map((r) => ({
      id: r.id,
      module: 'insurance',
      title: `${r.name} expires`,
      startsAt: r.expires_on,
      allDay: true,
      href: `/insurance?policy=${r.id}`,
      kind: 'expiry',
    }))
}

export async function calendarFor(range: { from: string; to: string }): Promise<CalendarItem[]> {
  const { rows } = await db().query<PolicyRow>(
    `select id, name, expires_on::text, status
       from insurance.policy
      where status = 'active'
        and expires_on between $1 and $2`,
    [range.from, range.to],
  )
  return toCalendarItems(rows, range)
}
