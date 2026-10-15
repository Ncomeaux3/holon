import { db } from '@/core/db'
import type { CalendarItem } from '@/core/module-contract'
import type { ChargeCadence } from './recurring'

// What Finance puts on the Calendar: a recurring charge, projected forward by
// its cadence. finance.recurring carries no active or status flag: the
// nightly job rewrites the whole table from the last 90 days of charges, so a
// row's presence is what "active" means here.
//
// No cross-module import: this is its own addMonths, not home's.

const addDays = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

/**
 * Step forward by `months`, keeping `anchorDay` as the day of month and
 * clamping to the target month's end. Re-anchoring matters: a charge clamped
 * to 28 February still targets 31 for March, not 28 again.
 */
function addMonthsAnchored(iso: string, months: number, anchorDay: number): string {
  const [y, m] = iso.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(anchorDay, lastDay))
  return target.toISOString().slice(0, 10)
}

/** Every occurrence from `firstOn` through `to`, the first real and the rest projected. */
export function projectCharges(
  cadence: ChargeCadence,
  firstOn: string,
  to: string,
): { date: string; projected: boolean }[] {
  const anchorDay = Number(firstOn.slice(8, 10))
  const step = (date: string): string => {
    if (cadence === 'weekly') return addDays(date, 7)
    if (cadence === 'monthly') return addMonthsAnchored(date, 1, anchorDay)
    if (cadence === 'quarterly') return addMonthsAnchored(date, 3, anchorDay)
    if (cadence === 'semiannual') return addMonthsAnchored(date, 6, anchorDay)
    return addMonthsAnchored(date, 12, anchorDay)
  }

  const occurrences: { date: string; projected: boolean }[] = []
  let date = firstOn
  let projected = false
  while (date <= to) {
    occurrences.push({ date, projected })
    date = step(date)
    projected = true
  }
  return occurrences
}

/**
 * The first charge on or after today. A posted row (an insurance premium) is
 * not rewritten by the detector, so the nightly job moves it on with this once
 * its date has passed. No cadence steps further than a year.
 */
export function rollForward(cadence: ChargeCadence, nextOn: string, todayIso: string): string {
  return projectCharges(cadence, nextOn, addDays(todayIso, 366)).find((o) => o.date >= todayIso)!.date
}

export type RecurringRow = {
  id: string
  merchant: string
  cadence: ChargeCadence
  next_charge_on: string
}

export function toCalendarItems(
  rows: RecurringRow[],
  range: { from: string; to: string },
): CalendarItem[] {
  const items: CalendarItem[] = []

  for (const r of rows) {
    for (const occ of projectCharges(r.cadence, r.next_charge_on, range.to)) {
      if (occ.date < range.from) continue
      items.push({
        id: `${r.id}:${occ.date}`,
        module: 'finance',
        title: r.merchant,
        startsAt: occ.date,
        allDay: true,
        href: '/finance?tab=subscriptions',
        kind: 'charge',
        projected: occ.projected,
      })
    }
  }

  return items
}

export async function calendarFor(range: { from: string; to: string }): Promise<CalendarItem[]> {
  const { rows } = await db().query<RecurringRow>(
    `select id, merchant, cadence, next_charge_on::text
       from finance.recurring
      where next_charge_on <= $1`,
    [range.to],
  )
  return toCalendarItems(rows, range)
}
