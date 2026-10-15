import { describe, expect, it } from 'vitest'
import { balance, budgetTone, compactMoney, flowReadout, monthPace, percent, signedMoney, transactionAmount } from './money'

describe('money rendering', () => {
  it('separates a debt from a fall, because the same glyph means two things', () => {
    // A credit card balance: negative means owed.
    expect(balance(-231_000)).toBe('-$2,310')
    // A thirty day change: negative means it went down.
    expect(signedMoney(-64_000)).toBe('-$640')
    // And a change of nothing is not "$0", it is flat.
    expect(signedMoney(0)).toBe('flat')
    // Whole dollars are what it renders, so a seven cent move has no signed
    // reading: the category trend's worst month was printing "-$0".
    expect(signedMoney(-7)).toBe('flat')
    expect(signedMoney(49)).toBe('flat')
    expect(signedMoney(-50)).toBe('-$1')
  })

  it('flips the sign for income, which is negative in the data', () => {
    expect(transactionAmount(-386_000)).toEqual({ text: '+$3,860.00', incoming: true })
    expect(transactionAmount(8412)).toEqual({ text: '-$84.12', incoming: false })
  })

  it('compacts only once the digits stop mattering', () => {
    expect(compactMoney(84_200)).toBe('$842')
    expect(compactMoney(3_120_000)).toBe('$31.2k')
    expect(compactMoney(-231_000)).toBe('-$2.3k')
    // An axis bound below zero keeps its sign, where money() drops it.
    expect(compactMoney(-73_900)).toBe('-$739')
  })
})

describe('percent', () => {
  it('rounds to a whole percent', () => {
    expect(percent(37_200, 60_000)).toBe(62)
    expect(percent(26_400, 30_000)).toBe(88)
  })

  it('survives a zero limit rather than returning Infinity', () => {
    expect(percent(1000, 0)).toBe(0)
  })

  it('caps, because a bar cannot be four thousand percent long', () => {
    expect(percent(4_000_000, 1000)).toBe(999)
  })

  it('floors at zero: a month of refunds is not negative use', () => {
    expect(percent(-4000, 20_000)).toBe(0)
  })
})

describe('budgetTone', () => {
  it('reads under, near and over the limit in three tones', () => {
    expect(budgetTone(12_400, 20_000, 80, false)).toEqual({ pct: 62, tone: 'ok', label: '62% used · $76 left' })
    expect(budgetTone(17_600, 20_000, 80, false)).toEqual({ pct: 88, tone: 'warn', label: '88% used · $24 left' })
    expect(budgetTone(43_600, 20_000, 80, false)).toEqual({ pct: 218, tone: 'bad', label: '218% used · $236 over' })
  })

  it('never shows a minus: a net credit month is 0% used', () => {
    expect(budgetTone(-4000, 20_000, 80, false)).toEqual({ pct: 0, tone: 'ok', label: '0% used · $240 left' })
  })

  it('keeps a fixed cost calm at its limit', () => {
    expect(budgetTone(20_000, 20_000, 80, true).tone).toBe('fixed')
  })
})

describe('monthPace', () => {
  it('is the fraction of the month gone', () => {
    // The 15th of a 30 day month.
    expect(monthPace('2026-09-15')).toBeCloseTo(0.5, 2)
    // The last day of a 31 day month.
    expect(monthPace('2026-10-31')).toBe(1)
  })

  it('knows how long February is', () => {
    expect(monthPace('2026-02-14')).toBeCloseTo(14 / 28, 3)
    // 2028 is a leap year.
    expect(monthPace('2028-02-14')).toBeCloseTo(14 / 29, 3)
  })
})

describe('flowReadout', () => {
  it('names the month with its year and gives in, out and what was left over', () => {
    expect(flowReadout({ month: '2026-09-01', incomeCents: 420_000, expenseCents: 310_050 })).toEqual({
      month: 'Sep 2026',
      in: '$4,200',
      out: '$3,101',
      leftOver: '+$1,100',
    })
  })

  it('signs a month that spent more than it took in', () => {
    expect(flowReadout({ month: '2026-01-01', incomeCents: 100_000, expenseCents: 164_000 }).leftOver).toBe('-$640')
  })

  it('reads under half a dollar either way as flat, not -$0', () => {
    expect(flowReadout({ month: '2026-03-01', incomeCents: 200_000, expenseCents: 200_040 }).leftOver).toBe('flat')
  })

  it('keeps the sign of spending a refund outran', () => {
    expect(flowReadout({ month: '2026-04-01', incomeCents: 0, expenseCents: -2_500 }).out).toBe('-$25')
  })
})
