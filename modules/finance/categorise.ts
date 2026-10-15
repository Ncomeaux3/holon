// Transaction categorisation. No imports: the Finance screen is a client
// component and anything reaching core/db.ts drags pg into the browser bundle.
//
// Rules first, model second. A month is hundreds of transactions and almost all
// of them are merchants you have seen before, so the job of this file is to
// leave as little as possible for a model call. Returning null is the whole
// interface to that: null means "ask the model", and everything here exists to
// return null less often.

export type Rule = {
  category: string
  /** Already normalised: lowercase, single spaced. */
  pattern: string
  /** True when the owner's own correction wrote it. Beats any automatic rule. */
  isManual: boolean
  /**
   * Breaks the tie before length does. Zero for everything the owner or the
   * model writes; only the built-ins below set it, and only where one
   * descriptor legitimately matches two of them.
   */
  priority?: number
}

export type Match = {
  category: string
  confidence: number
  classifiedBy: 'rule'
  /** Which pattern hit, so the UI can say why. */
  matched: string
}

/** Lowercase, punctuation to spaces, runs of space collapsed. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * The prefixes card processors staple onto a descriptor. Stripping them is what
 * turns "SQ *ROSIES CANTINA 00123" into a merchant rather than a receipt.
 */
const PROCESSOR_PREFIXES = /^(sq|tst|sp|pp|paypal|pos|dd|ext|pymt|purchase)\s+/

/**
 * Strip the trailing reference, then the store code hiding in front of it.
 *
 * "wholefds abc 10045" has to become "wholefds", or the learned rule matches
 * one branch and asks again at the next. But "big spoon creamery" has to
 * survive intact, and a rule that simply dropped short trailing tokens would
 * eat it.
 *
 * The distinguishing fact is the number: a short token is a store code only
 * when a reference number followed it. Drop the numeric tail first, and only
 * then drop a short token that the tail was sitting behind.
 */
function stripReference(pattern: string): string {
  const tokens = pattern.split(' ').filter(Boolean)

  let droppedNumber = false
  while (tokens.length > 0 && /\d/.test(tokens[tokens.length - 1])) {
    tokens.pop()
    droppedNumber = true
  }

  if (droppedNumber && tokens.length > 1 && tokens[tokens.length - 1].length <= 3) {
    tokens.pop()
  }

  return tokens.join(' ')
}

/** Shorter than this matches too much of the ledger to be safe to learn. */
export const MIN_PATTERN_LENGTH = 3

/** Below this a pattern matches as a whole word only: "rei" is REI, never "reimbursement". */
const WHOLE_WORD_BELOW = 4

/** Whether a rule can be written on this normalised pattern at all. */
export function learnable(pattern: string): boolean {
  return pattern.length >= MIN_PATTERN_LENGTH && /[a-z]/.test(pattern)
}

/** Whether a normalised descriptor carries this pattern. */
export function matches(text: string, pattern: string): boolean {
  return pattern.length < WHOLE_WORD_BELOW ? ` ${text} `.includes(` ${pattern} `) : text.includes(pattern)
}

/**
 * The first rule that matches, ranked.
 *
 * Manual before automatic, then priority, then longest first. Manual wins
 * outright because the owner's correction is the one fact in the system that a
 * job may never overwrite; priority settles the built-ins that legitimately
 * match the same descriptor; length breaks the rest, so "amazon prime" beats
 * "amazon" and the specific rule is the one that fires.
 */
export function categorise(
  descriptor: string,
  rules: Rule[],
  /** Names of the institutions behind the owner's credit accounts. */
  institutions: string[] = [],
): Match | null {
  const text = normalise(descriptor)

  const ranked = [...rules].sort((a, b) => {
    if (a.isManual !== b.isManual) return a.isManual ? -1 : 1
    if ((a.priority ?? 0) !== (b.priority ?? 0)) return (b.priority ?? 0) - (a.priority ?? 0)
    return b.pattern.length - a.pattern.length
  })

  for (const rule of ranked) {
    if (matches(text, rule.pattern)) {
      return {
        category: rule.category,
        // A rule is a fact, not an estimate. Only the model arm produces a
        // confidence below one, which is what makes the number meaningful.
        confidence: 1,
        classifiedBy: 'rule',
        matched: rule.pattern,
      }
    }
  }

  // No pattern can name the owner's own bank in advance: "NORTHWIND ONLINE
  // PMT" is a card payment only because Northwind is one of their cards.
  // The institution and a payment word together are the rule.
  if (
    PAYMENT_WORD.test(text) &&
    institutions.some((name) => normalise(name).length >= WHOLE_WORD_BELOW && text.includes(normalise(name)))
  ) {
    return {
      category: CARD_PAYMENT,
      confidence: 1,
      classifiedBy: 'rule',
      matched: 'institution payment',
    }
  }

  return null
}

const CARD_PAYMENT = 'Credit card payment'
/** Money to or from an individual. Spending, not a transfer: v1.2 phase 5c. */
const PEOPLE = 'People'
const PAYMENT_WORD = /\b(payment|pmt|autopay|epay)/

/**
 * The rules every ledger needs and nobody should have to teach.
 *
 * Paying a card off is a transfer between the owner's own accounts and must
 * never count as spending on either side; a statement credit belongs against
 * the category it refunds, not as income. These are appended after the learned
 * rules, so a manual rule still wins, and the descriptors are the common ones
 * (verify against the owner's own statements; the doc says so).
 */
export const BUILTIN_RULES: Rule[] = [
  // Ahead of the transfer patterns, and the only reason priority exists.
  // "Zelle Transfer to Jane" carries both `zelle` and `transfer to`, and
  // `transfer to` is the longer pattern, so on length alone money to a person
  // was a move between the owner's own accounts and counted as no spending.
  { category: PEOPLE, pattern: 'zelle', isManual: false, priority: 1 },
  { category: PEOPLE, pattern: 'venmo', isManual: false, priority: 1 },
  { category: PEOPLE, pattern: 'cash app', isManual: false, priority: 1 },
  { category: CARD_PAYMENT, pattern: 'payment thank you', isManual: false },
  { category: CARD_PAYMENT, pattern: 'epayment', isManual: false },
  { category: CARD_PAYMENT, pattern: 'e payment', isManual: false },
  { category: CARD_PAYMENT, pattern: 'credit crd autopay', isManual: false },
  { category: CARD_PAYMENT, pattern: 'autopay payment', isManual: false },
  { category: 'Account transfer', pattern: 'online transfer', isManual: false },
  { category: 'Account transfer', pattern: 'transfer to', isManual: false },
  { category: 'Account transfer', pattern: 'transfer from', isManual: false },
  { category: 'Statement credit', pattern: 'membership rewards credit', isManual: false },
  { category: 'Dining', pattern: 'dining credit', isManual: false },
  { category: 'Travel', pattern: 'uber credit', isManual: false },
]

/**
 * Money back on a card from a merchant charged recently is a refund of that
 * charge, and it nets against the charge's category. With no category on the
 * charge it is a Refund, which is a credit kind and never income. Null means
 * this is not a refund at all: a charge, a deposit, or a merchant never seen.
 */
export function matchRefund(
  row: { merchant: string; amountCents: number; accountKind: string },
  recentCharges: { merchant: string; amountCents: number; category: string | null }[],
): string | null {
  // A blank descriptor is not a merchant, and two blanks are not the same one.
  if (row.accountKind !== 'credit' || row.amountCents >= 0 || row.merchant === '') return null
  const charge = recentCharges.find((c) => c.amountCents > 0 && c.merchant === row.merchant)
  if (!charge) return null
  return charge.category ?? 'Refund'
}

/**
 * Turn a correction into a rule, so the same merchant is never asked about
 * twice.
 *
 * This is the cheapest thing in the module: every rule learned here is a model
 * call not made next month. It is also the riskiest, which is why the pattern
 * has to survive both the processor prefix and the store number before it is
 * kept, and why anything too short is refused outright. A bad rule mis-files
 * quietly, and quiet is the failure mode worth spending code to avoid.
 */
export function learnFrom(descriptor: string, category: string): Rule | null {
  let pattern = normalise(descriptor)

  // Strip repeatedly: "sq tst rosies" is not a merchant either.
  let previous = ''
  while (pattern !== previous) {
    previous = pattern
    pattern = pattern.replace(PROCESSOR_PREFIXES, '').trim()
  }

  pattern = stripReference(pattern)

  // A descriptor that is only digits leaves nothing to learn.
  if (!learnable(pattern)) return null

  return { category, pattern, isManual: true }
}
