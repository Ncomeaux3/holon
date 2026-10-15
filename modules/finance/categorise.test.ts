import { describe, expect, it } from 'vitest'
import { BUILTIN_RULES, categorise, learnFrom, matchRefund, type Rule } from './categorise'

// "Rules first, model second" is a rule of the whole system, and this is where
// it costs the most: a month of transactions is hundreds of rows, and sending
// every one to a model would be both slow and the largest line on the bill.
//
// So the model is the exception, not the path. Everything here is about how few
// rows reach it.

const rules: Rule[] = [
  { category: 'Groceries', pattern: 'kroger', isManual: false },
  { category: 'Groceries', pattern: 'publix', isManual: false },
  { category: 'Dining', pattern: 'chipotle', isManual: false },
  { category: 'Dining', pattern: 'starbucks', isManual: false },
  { category: 'Subscriptions', pattern: 'anthropic', isManual: false },
  { category: 'Income', pattern: 'payroll', isManual: false },
]

describe('categorise', () => {
  it('matches a rule and says the rule decided it', () => {
    expect(categorise('KROGER #412', rules)).toEqual({
      category: 'Groceries',
      confidence: 1,
      classifiedBy: 'rule',
      matched: 'kroger',
    })
  })

  it('matches case and punctuation insensitively', () => {
    expect(categorise('Chipotle Mexican Grill', rules)?.category).toBe('Dining')
    expect(categorise('STARBUCKS  #1183', rules)?.category).toBe('Dining')
    expect(categorise('anthropic-claude-pro', rules)?.category).toBe('Subscriptions')
  })

  it('returns nothing when no rule matches, rather than guessing', () => {
    // Null is what sends this one row to the model. Returning a low confidence
    // guess here would be the whole cost saving thrown away.
    expect(categorise('Rosie&apos;s Cantina', rules)).toBeNull()
  })

  it('prefers the longest matching pattern, so the specific rule wins', () => {
    const overlapping: Rule[] = [
      { category: 'Shopping', pattern: 'amazon', isManual: false },
      { category: 'Subscriptions', pattern: 'amazon prime', isManual: false },
    ]
    expect(categorise('AMAZON PRIME*2H4KL', overlapping)?.category).toBe('Subscriptions')
    expect(categorise('AMAZON MKTPLACE', overlapping)?.category).toBe('Shopping')
  })

  it('lets a manual rule beat an automatic one of any length', () => {
    // The owner moved Cosmic Coffee to Dining by hand. That decision outranks
    // any pattern a job wrote, which is the manual override rule of the system.
    const mixed: Rule[] = [
      { category: 'Groceries', pattern: 'cosmic coffee roasters', isManual: false },
      { category: 'Dining', pattern: 'cosmic', isManual: true },
    ]
    expect(categorise('Cosmic Coffee Roasters', mixed)).toMatchObject({
      category: 'Dining',
      classifiedBy: 'rule',
    })
  })
})

describe('learnFrom', () => {
  it('turns a correction into a rule', () => {
    const rule = learnFrom('COSMIC COFFEE #3', 'Dining')
    expect(rule).toMatchObject({ category: 'Dining', isManual: true })
    // The stable part of the descriptor, without the store number.
    expect(rule?.pattern).toBe('cosmic coffee')
  })

  it('strips the noise a card processor adds', () => {
    expect(learnFrom('SQ *ROSIES CANTINA 00123', 'Dining')?.pattern).toBe('rosies cantina')
    expect(learnFrom('TST* BIG SPOON CREAMERY', 'Dining')?.pattern).toBe('big spoon creamery')
    expect(learnFrom('PAYPAL *VERCELINC', 'Subscriptions')?.pattern).toBe('vercelinc')
  })

  it('refuses to learn a pattern too short to be safe', () => {
    // A two character pattern would match half the ledger. Better to keep
    // asking than to mis-file everything quietly.
    expect(learnFrom('SQ *AB 0012', 'Dining')).toBeNull()
    expect(learnFrom('12345', 'Dining')).toBeNull()
  })

  it('learns a three letter merchant and matches it as a whole word only', () => {
    // REI was listed as unfiled with no way to file it. Three letters is safe
    // only as a word: "rei" must not file every reimbursement.
    expect(learnFrom('REI #0123', 'Shopping')?.pattern).toBe('rei')
    const short: Rule[] = [{ category: 'Shopping', pattern: 'rei', isManual: true }]
    expect(categorise('REI #1234 SEATTLE', short)?.category).toBe('Shopping')
    expect(categorise('rei.com', short)?.category).toBe('Shopping')
    expect(categorise('REIMBURSEMENT ACH', short)).toBeNull()
    expect(categorise('THEREIN LLC', short)).toBeNull()
  })

  it('learns a rule that then matches the thing it came from', () => {
    const rule = learnFrom('WHOLEFDS ABC 10045', 'Groceries')!
    expect(categorise('WHOLEFDS ABC 10045', [rule])?.category).toBe('Groceries')
    // And the next store, which is the point of learning it.
    expect(categorise('WHOLEFDS XYZ 20099', [rule])?.category).toBe('Groceries')
  })
})

// v1.2 phase 5a. The rules that keep a card payment out of spending and put a
// credit against the category it refunds. One test per rule.
describe('built-in rules', () => {
  const builtin = [...rules, ...BUILTIN_RULES]

  it('files the card side of a payment as Credit card payment', () => {
    expect(categorise('Payment Thank You - Web', builtin)?.category).toBe('Credit card payment')
    expect(categorise('MOBILE PAYMENT - THANK YOU', builtin)?.category).toBe('Credit card payment')
  })

  it('files the checking side of a payment as Credit card payment', () => {
    expect(categorise('AMEX EPAYMENT ACH PMT', builtin)?.category).toBe('Credit card payment')
    expect(categorise('DISCOVER E-PAYMENT', builtin)?.category).toBe('Credit card payment')
    expect(categorise('NORTHWIND CREDIT CRD AUTOPAY', builtin)?.category).toBe('Credit card payment')
  })

  it('files a payment naming one of the owner’s card institutions', () => {
    // No built-in pattern knows this descriptor; the institution list does.
    expect(categorise('NORTHWIND ONLINE PMT', builtin)).toBeNull()
    expect(categorise('NORTHWIND ONLINE PMT', builtin, ['Northwind'])?.category).toBe(
      'Credit card payment',
    )
    // The name alone is not a payment: a purchase at a Northwind Cafe stays unmatched.
    expect(categorise('NORTHWIND CAFE', builtin, ['Northwind'])).toBeNull()
  })

  it('files a move between own accounts as Account transfer', () => {
    expect(categorise('ONLINE TRANSFER TO SAV ...5207', builtin)?.category).toBe('Account transfer')
    expect(categorise('Transfer from Checking', builtin)?.category).toBe('Account transfer')
  })

  it('files a rewards credit as Statement credit', () => {
    expect(categorise('MEMBERSHIP REWARDS CREDIT', builtin)?.category).toBe('Statement credit')
  })

  it('nets a named credit against the category it refunds', () => {
    expect(categorise('DINING CREDIT', builtin)?.category).toBe('Dining')
    expect(categorise('UBER CREDIT', builtin)?.category).toBe('Travel')
  })

  // v1.2 phase 5c. "Zelle Transfer to Jane" carries both `zelle` and
  // `transfer to`, and `transfer to` is the longer pattern, so length alone
  // filed money to a person as a move between the owner's own accounts and
  // counted it as no spending at all. Precedence is the whole fix.
  it('files money to a person as People, ahead of the transfer patterns', () => {
    expect(categorise('ZELLE TRANSFER TO JANE DOE NWB4410', builtin)?.category).toBe('People')
    expect(categorise('Zelle payment from John Smith', builtin)?.category).toBe('People')
    expect(categorise('VENMO *CASHOUT', builtin)?.category).toBe('People')
    expect(categorise('CASH APP*MIKE R', builtin)?.category).toBe('People')
  })

  it('leaves the owner’s own transfers as Account transfer', () => {
    expect(categorise('ONLINE TRANSFER TO SAV ...5207', builtin)?.category).toBe('Account transfer')
  })

  it('lets a manual rule beat a peer payment, because a correction always wins', () => {
    const manual: Rule = { category: 'Travel', pattern: 'zelle transfer to jane', isManual: true }
    expect(categorise('ZELLE TRANSFER TO JANE DOE', [...builtin, manual])?.category).toBe('Travel')
  })

  it('still lets a manual rule win over a built-in', () => {
    const manual: Rule = { category: 'Shopping', pattern: 'uber credit', isManual: true }
    expect(categorise('UBER CREDIT', [...builtin, manual])?.category).toBe('Shopping')
  })
})

describe('matchRefund', () => {
  const recent = [
    { merchant: 'chipotle', amountCents: 1485, category: 'Dining' },
    { merchant: 'mystery shop', amountCents: 4200, category: null },
  ]

  it('files money back from a recent merchant into that charge’s category', () => {
    expect(matchRefund({ merchant: 'chipotle', amountCents: -1485, accountKind: 'credit' }, recent)).toBe('Dining')
  })

  it('files money back from an uncategorised charge as Refund', () => {
    expect(matchRefund({ merchant: 'mystery shop', amountCents: -4200, accountKind: 'credit' }, recent)).toBe('Refund')
  })

  it('leaves a credit with no matching charge alone', () => {
    expect(matchRefund({ merchant: 'new place', amountCents: -900, accountKind: 'credit' }, recent)).toBeNull()
  })

  it('never matches a blank descriptor to another blank one', () => {
    const blanks = [{ merchant: '', amountCents: 500, category: 'Dining' }]
    expect(matchRefund({ merchant: '', amountCents: -500, accountKind: 'credit' }, blanks)).toBeNull()
  })

  it('is only for money back on a card', () => {
    // A charge is not a refund, and a deposit into checking is income or a
    // transfer, never a refund of a card purchase.
    expect(matchRefund({ merchant: 'chipotle', amountCents: 1485, accountKind: 'credit' }, recent)).toBeNull()
    expect(matchRefund({ merchant: 'chipotle', amountCents: -1485, accountKind: 'checking' }, recent)).toBeNull()
  })
})
