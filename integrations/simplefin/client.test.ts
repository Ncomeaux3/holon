import { describe, expect, it } from 'vitest'

import { inferKind, parseAccounts, toCents } from './client'

// SimpleFIN sends money as a decimal string in the account's currency and the
// column is bigint cents, so this conversion sits between the bank and every
// number on the Finance screen. It is the one piece of arithmetic in the
// integration and the only place a rounding mistake would be silent.

describe('toCents', () => {
  it('converts the ordinary cases', () => {
    expect(toCents('32.45')).toBe(3245)
    expect(toCents('-32.45')).toBe(-3245)
    expect(toCents('0.00')).toBe(0)
    expect(toCents('1450')).toBe(145000)
  })

  // 32.45 * 100 is 3244.9999999999995 in float64. Without the round this
  // returns 3244 and every statement is a cent light.
  it('rounds the float representation back to the right cent', () => {
    expect(toCents('32.45')).toBe(3245)
    expect(toCents('8.21')).toBe(821)
    expect(toCents('119.99')).toBe(11999)
    expect(toCents('-0.29')).toBe(-29)
  })

  it('handles a single decimal place and stray whitespace', () => {
    expect(toCents('5.5')).toBe(550)
    expect(toCents('  -12.30  ')).toBe(-1230)
  })

  // Crypto and some brokerages send more precision than a cent. Rounding is
  // what the column can hold, so it is what happens, rather than truncating.
  it('rounds anything finer than a cent', () => {
    expect(toCents('0.005')).toBe(1)
    expect(toCents('0.004')).toBe(0)
  })

  it('refuses anything that is not a number rather than storing zero', () => {
    expect(() => toCents('')).toThrow()
    expect(() => toCents('n/a')).toThrow()
    expect(() => toCents('12.34.56')).toThrow()
  })

  it('survives a balance larger than any real account', () => {
    expect(toCents('99999999.99')).toBe(9999999999)
  })
})

// SimpleFIN has no account type field, so the name is the only signal. Wrong
// guesses only affect grouping on the screen: net worth is a plain sum either
// way, which is why guessing is acceptable here at all.
describe('inferKind', () => {
  it('reads the obvious names', () => {
    expect(inferKind('Northwind Total Checking')).toBe('checking')
    expect(inferKind('Bluewater Online Savings')).toBe('savings')
    expect(inferKind('Northwind Rewards Visa')).toBe('credit')
    expect(inferKind('Harbor Roth IRA')).toBe('retirement')
    expect(inferKind('Vanguard Brokerage')).toBe('brokerage')
    expect(inferKind('Coinbase BTC')).toBe('crypto')
  })

  it('prefers retirement over brokerage when a name says both', () => {
    expect(inferKind('Harbor Brokerage Roth IRA')).toBe('retirement')
  })

  it('falls back to other rather than guessing', () => {
    expect(inferKind('Account 4')).toBe('other')
    expect(inferKind('')).toBe('other')
  })

  it('does not fire on a word that merely contains a keyword', () => {
    // "cardiology" contains "card", and word boundaries are what stop it.
    expect(inferKind('Cardiology HSA')).toBe('other')
  })
})

// The sign. SimpleFIN says "positive numbers indicate money being deposited
// into the account"; this schema says positive is money out. Storing the
// protocol's sign unchanged inverted every purchase in production, which read
// as income: budgets summed to nothing, recurring detection saw only the
// paycheck, and the unusual list named deposits. The flip lives here, at the
// protocol boundary, so nothing downstream has to know the bank's convention.
describe('parseAccounts', () => {
  const body = {
    accounts: [
      {
        id: 'acct-1',
        name: 'Card 1009',
        currency: 'USD',
        balance: '-231.00',
        'balance-date': 1_760_000_000,
        org: { name: 'Demo Card' },
        transactions: [
          { id: 't1', posted: 1_759_900_000, amount: '-32.45', description: 'Corner Bistro' },
          { id: 't2', posted: 1_759_800_000, amount: '12.30', description: 'Refund' },
          { id: 't3', posted: 0, transacted_at: 1_759_990_000, amount: '-8.00', description: 'Taco truck' },
        ],
      },
    ],
  }

  it('stores a purchase as money out and a refund as money in', () => {
    const [account] = parseAccounts(body).accounts
    expect(account.transactions.map((t) => t.amountCents)).toEqual([3245, -1230, 800])
  })

  it('leaves the balance in the protocol’s sign, where a card owed is negative', () => {
    // Net worth is a plain sum over balances, so a card has to stay negative.
    expect(parseAccounts(body).accounts[0].balanceCents).toBe(-23100)
  })

  it('marks an unposted row pending and dates it from transacted_at', () => {
    const pending = parseAccounts(body).accounts[0].transactions[2]
    expect(pending.pending).toBe(true)
    expect(pending.occurredOn.getTime()).toBe(1_759_990_000_000)
  })

  it('reads both the version 1 and version 2 error shapes', () => {
    expect(parseAccounts({ errlist: [{ code: 'x', msg: 'bank down' }] }).warnings).toEqual(['bank down'])
    expect(parseAccounts({ errors: ['bank down'] }).warnings).toEqual(['bank down'])
  })
})
