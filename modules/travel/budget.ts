// The trip budget by category. No imports: the drawer is a client component.

export type Kind = 'flight' | 'lodging' | 'transit' | 'activity' | 'food'

type Item = { kind: string; status: string; amount_cents: number }
type Line = { category: string; actual_override_cents: number | null }

/** "Flights" is the flight kind, "Food & drink" is food; a category the itinerary has no kind for sums nothing. */
export function kindFor(category: string): Kind | null {
  const c = category.toLowerCase()
  if (/flight|air/.test(c)) return 'flight'
  if (/lodg|hotel|stay|airbnb/.test(c)) return 'lodging'
  if (/food|drink|dining|meal|restaurant/.test(c)) return 'food'
  if (/transit|transport|train|taxi|rail|car/.test(c)) return 'transit'
  if (/activit|tour|ticket|experience/.test(c)) return 'activity'
  return null
}

/** The line's actual: what the owner typed over, else the confirmed items of its kind. */
export function actualFor(line: Line, items: Item[]): number {
  if (line.actual_override_cents !== null) return line.actual_override_cents
  const kind = kindFor(line.category)
  if (!kind) return 0
  return items
    .filter((i) => i.status === 'confirmed' && i.kind === kind)
    .reduce((sum, i) => sum + i.amount_cents, 0)
}

/**
 * What is left of the budget: the budget less the larger of planned (the
 * confirmed itinerary) and spent (the transactions tagged to the trip). The
 * larger, not the sum: a booked hotel shows up in both once its charge lands,
 * and counting it twice would put every paid trip over.
 */
export function remaining(budgetCents: number, plannedCents: number, spentCents: number): number {
  return budgetCents - Math.max(plannedCents, spentCents)
}

/** "Gifts 200" is a category and a planned figure in dollars; a bare name plans nothing yet. */
export function parseCategory(text: string): { category: string; dollars: number } | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const m = trimmed.match(/^(.*?)\s+\$?(\d+(?:\.\d+)?)$/)
  if (m) return { category: m[1].trim(), dollars: Number(m[2]) }
  return { category: trimmed, dollars: 0 }
}
