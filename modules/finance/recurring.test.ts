import { describe, expect, it } from 'vitest'
import { detectRecurring, monthlyEquivalent, type Charge } from './recurring'

// SPEC: same merchant, amount within 10 percent, regular cadence (weekly,
// monthly, yearly). This is the detector that fills the subscriptions table and
// the upcoming charges tile, so it is written test first.
//
// The bar throughout: a false positive puts a bill on the dashboard that is not
// real, and a missed one is a charge nobody warned you about. Of the two, the
// false positive is worse, because it teaches you to ignore the tile.

const charge = (merchant: string, cents: number, daysAgo: number): Charge => ({
  merchant,
  amountCents: cents,
  // 2026-09-08 minus daysAgo, as a plain date.
  occurredOn: new Date(Date.UTC(2026, 8, 8) - daysAgo * 86_400_000).toISOString().slice(0, 10),
})

/** Monthly on the same day, n times back from today. */
const monthly = (merchant: string, cents: number, count: number, jitter: number[] = []) =>
  Array.from({ length: count }, (unused, i) =>
    charge(merchant, cents + (jitter[i] ?? 0), i * 30),
  )

describe('detectRecurring', () => {
  it('finds nothing in a single charge', () => {
    expect(detectRecurring([charge('Claude Pro', 2000, 3)])).toEqual([])
  })

  it('will not call two charges a subscription', () => {
    // Two points is a line through any two points. A cadence needs a third to
    // be a cadence rather than a coincidence.
    expect(detectRecurring([charge('Vercel', 2000, 3), charge('Vercel', 2000, 33)])).toEqual([])
  })

  it('detects a monthly charge from three occurrences', () => {
    const found = detectRecurring(monthly('Claude Pro', 2000, 3))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      merchant: 'Claude Pro',
      cadence: 'monthly',
      amountCents: 2000,
      occurrences: 3,
    })
  })

  it('detects weekly and yearly cadences too', () => {
    const weekly = Array.from({ length: 4 }, (unused, i) => charge('Cleaner', 8000, i * 7))
    expect(detectRecurring(weekly)[0]).toMatchObject({ cadence: 'weekly' })

    const yearly = Array.from({ length: 3 }, (unused, i) => charge('Domain', 1200, i * 365))
    expect(detectRecurring(yearly)[0]).toMatchObject({ cadence: 'yearly' })
  })

  it('tolerates the ten percent the spec allows, and nothing past it', () => {
    // 2000, 2100, 1900: every one inside ten percent of the median.
    const within = detectRecurring(monthly('Utility', 2000, 3, [0, 100, -100]))
    expect(within).toHaveLength(1)

    // 2000, 2000, 3000: the last is fifty percent out, so this is a merchant
    // you happen to buy from monthly, not a subscription.
    expect(detectRecurring(monthly('Corner shop', 2000, 3, [0, 0, 1000]))).toEqual([])
  })

  it('reports the median amount, so one odd month does not move it', () => {
    const found = detectRecurring(monthly('Gym', 4500, 5, [0, 0, 200, 0, 0]))
    expect(found[0].amountCents).toBe(4500)
  })

  it('allows the wobble a real monthly bill has', () => {
    // Billed on the 1st, but the 1st falls on a weekend: 28 to 33 day gaps.
    const wobbly = [charge('Rent', 145_000, 0), charge('Rent', 145_000, 28), charge('Rent', 145_000, 61)]
    expect(detectRecurring(wobbly)[0]).toMatchObject({ cadence: 'monthly' })
  })

  it('rejects an irregular cadence, however many charges there are', () => {
    // Groceries: same shop, similar amount, no rhythm at all.
    const random = [0, 2, 3, 9, 11, 12, 19, 30].map((d) => charge('Greenleaf Market', 8000, d))
    expect(detectRecurring(random)).toEqual([])
  })

  it('matches merchants case and punctuation insensitively', () => {
    const messy = [
      charge('CLAUDE PRO', 2000, 0),
      charge('Claude  Pro', 2000, 30),
      charge('claude-pro', 2000, 60),
    ]
    expect(detectRecurring(messy)).toHaveLength(1)
  })

  it('projects the next charge one cadence past the last one', () => {
    const found = detectRecurring(monthly('Claude Pro', 2000, 3))
    // Last charge was today, so the next is about a month out.
    expect(found[0].nextChargeOn).toBe('2026-10-08')
  })

  it('keeps two different merchants apart', () => {
    const both = [...monthly('Vercel', 2000, 3), ...monthly('Supabase', 2500, 3)]
    const found = detectRecurring(both)
    expect(found.map((f) => f.merchant).sort()).toEqual(['Supabase', 'Vercel'])
  })

  it('ignores income, because a paycheck is not a subscription', () => {
    // Money coming in is negative by this module's convention.
    const payroll = Array.from({ length: 4 }, (unused, i) => charge('Payroll', -386_000, i * 14))
    expect(detectRecurring(payroll)).toEqual([])
  })
})

describe('monthlyEquivalent', () => {
  it('spreads a charge over the months it covers', () => {
    expect(monthlyEquivalent(120_000, 'semiannual')).toBe(20_000)
    expect(monthlyEquivalent(30_000, 'quarterly')).toBe(10_000)
    expect(monthlyEquivalent(12_000, 'yearly')).toBe(1_000)
    expect(monthlyEquivalent(1_500, 'monthly')).toBe(1_500)
    expect(monthlyEquivalent(1_200, 'weekly')).toBe(5_200)
  })
})
