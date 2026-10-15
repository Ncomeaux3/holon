import { db } from '@/core/db'
import type { CalendarItem } from '@/core/module-contract'

// What Meals puts on the Calendar: one all-day item per planned slot.

const SLOT_LABEL: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
}

export type PlanRow = {
  id: string
  on_date: string
  slot: string
  label: string
  recipe_name: string | null
  eaten: boolean
}

export function toCalendarItems(rows: PlanRow[], range: { from: string; to: string }): CalendarItem[] {
  return rows
    .filter((r) => r.on_date >= range.from && r.on_date <= range.to)
    .map((r) => ({
      id: r.id,
      module: 'meals',
      title: `${SLOT_LABEL[r.slot] ?? r.slot}: ${r.recipe_name || r.label || 'Meal'}`,
      startsAt: r.on_date,
      allDay: true,
      href: '/meals',
      kind: 'meal',
      done: r.eaten,
    }))
}

export async function calendarFor(range: { from: string; to: string }): Promise<CalendarItem[]> {
  const { rows } = await db().query<PlanRow>(
    `select p.id, p.on_date::text, p.slot, p.label, p.eaten, r.name as recipe_name
       from meals.plan_entry p
       left join meals.recipe r on r.id = p.recipe_id
      where p.on_date between $1 and $2`,
    [range.from, range.to],
  )
  return toCalendarItems(rows, range)
}
