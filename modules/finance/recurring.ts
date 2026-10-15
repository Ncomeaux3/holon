// Recurring charge detection. No imports: the Finance screen is a client
// component and anything reaching core/db.ts drags pg into the browser bundle.
//
// SPEC: same merchant, amount within 10 percent, regular cadence. Deterministic
// and rules only, with no model call anywhere: a subscription is an arithmetic
// fact about a list of dates, and paying a model to notice one would be both
// slower and less reliable.
//
// The bias throughout is against false positives. A bill on the dashboard that
// is not real teaches you to ignore the tile, and an ignored tile is worse than
// an empty one.

export type Charge = {
  merchant: string
  /** Positive is money out. Income is negative, and is never a subscription. */
  amountCents: number
  /** YYYY-MM-DD. */
  occurredOn: string
}

export type Cadence = 'weekly' | 'monthly' | 'yearly'

/** What a stored row can bill on: the detected three, plus what another module posts. */
export type ChargeCadence = Cadence | 'quarterly' | 'semiannual'

const PER_MONTH: Record<ChargeCadence, number> = {
  weekly: 52 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  semiannual: 1 / 6,
  yearly: 1 / 12,
}

/** What a charge costs a month, so a $1,200 premium every six months reads as $200. */
export function monthlyEquivalent(amountCents: number, cadence: ChargeCadence): number {
  return Math.round(amountCents * PER_MONTH[cadence])
}

export type Recurring = {
  merchant: string
  /** The median, so one odd month does not move it. */
  amountCents: number
  cadence: Cadence
  occurrences: number
  lastChargeOn: string
  nextChargeOn: string
}

/** Two points describe any line. A cadence needs a third to be a cadence. */
const MIN_OCCURRENCES = 3

/** SPEC's tolerance: within ten percent of the median counts as the same charge. */
const AMOUNT_TOLERANCE = 0.1

/**
 * What each cadence looks like as a gap in days, and how far a real bill is
 * allowed to wander from it.
 *
 * Monthly is the wide one on purpose: months are 28 to 31 days, billing dates
 * land on weekends and get pushed, and a card that posts a day late is still
 * the same subscription.
 */
const CADENCES: { cadence: Cadence; days: number; slack: number }[] = [
  { cadence: 'weekly', days: 7, slack: 2 },
  { cadence: 'monthly', days: 30, slack: 5 },
  { cadence: 'yearly', days: 365, slack: 20 },
]

/** Lowercase, and punctuation and runs of space collapsed. "CLAUDE PRO" and "claude-pro" are one merchant. */
function normalise(merchant: string): string {
  return merchant
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid]
}

const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

export function detectRecurring(charges: Charge[]): Recurring[] {
  const byMerchant = new Map<string, Charge[]>()

  for (const charge of charges) {
    // Income is not a subscription however regular it is. A fortnightly
    // paycheck is the most regular thing in the data and belongs nowhere near
    // the upcoming charges tile.
    if (charge.amountCents <= 0) continue

    const key = normalise(charge.merchant)
    byMerchant.set(key, [...(byMerchant.get(key) ?? []), charge])
  }

  const found: Recurring[] = []

  for (const group of byMerchant.values()) {
    if (group.length < MIN_OCCURRENCES) continue

    const amount = median(group.map((c) => c.amountCents))
    // Every charge has to be inside the tolerance, not the average of them: a
    // group with one wild outlier is a merchant you visit, not a bill.
    const consistent = group.every(
      (c) => Math.abs(c.amountCents - amount) <= amount * AMOUNT_TOLERANCE,
    )
    if (!consistent) continue

    const dates = [...group].sort((a, b) => dayOf(a.occurredOn) - dayOf(b.occurredOn))
    const gaps: number[] = []
    for (let i = 1; i < dates.length; i++) {
      gaps.push(dayOf(dates[i].occurredOn) - dayOf(dates[i - 1].occurredOn))
    }

    const cadence = CADENCES.find((c) => gaps.every((g) => Math.abs(g - c.days) <= c.slack))
    if (!cadence) continue

    const last = dates[dates.length - 1].occurredOn

    found.push({
      merchant: group[group.length - 1].merchant,
      amountCents: amount,
      cadence: cadence.cadence,
      occurrences: group.length,
      lastChargeOn: last,
      nextChargeOn: addDays(last, cadence.days),
    })
  }

  return found.sort((a, b) => a.nextChargeOn.localeCompare(b.nextChargeOn))
}

/**
 * A subscription with no matching charge in two cycles, per SPEC.
 *
 * Two rather than one because a single missed cycle is usually a billing date
 * that moved, and flagging on one would cry wolf every time a card was
 * reissued.
 */
export function isStale(
  subscription: { cadence: Cadence; lastChargeOn: string },
  todayIso: string,
): boolean {
  const days = CADENCES.find((c) => c.cadence === subscription.cadence)?.days ?? 30
  return dayOf(todayIso) - dayOf(subscription.lastChargeOn) > days * 2
}
