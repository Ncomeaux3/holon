import { getCredentials } from '@/core/credentials'

// SimpleFIN Bridge. Verified 2026-09-09 against simplefin.org/protocol.html.
//
// Two things about the protocol are worth knowing before reading the rest:
// money arrives as a decimal string in the account's own currency, not cents,
// and every date is Unix epoch seconds. Both are converted here so nothing
// downstream has to remember.
//
// Read only. SimpleFIN has no write surface at all, which is the point of it.

export class SimpleFinError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SimpleFinError'
  }
}

/**
 * Exchange a setup token for an access URL. Once only, per token.
 *
 * The token is a base64 encoded URL. POSTing to it returns the access URL,
 * which carries its own basic auth credentials in the userinfo and is the
 * thing worth storing. A second claim of the same token returns 403, so this
 * runs when the owner pastes a token and never again.
 */
export async function claim(setupToken: string): Promise<string> {
  let url: string
  try {
    url = Buffer.from(setupToken.trim(), 'base64').toString('utf8')
  } catch {
    throw new SimpleFinError(0, 'That does not decode as a SimpleFIN setup token.')
  }
  if (!/^https:\/\//.test(url)) {
    throw new SimpleFinError(0, 'That token decodes to something that is not an https URL.')
  }

  const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(30_000) })
  if (!res.ok) {
    // 403 here almost always means the token was already claimed, which is a
    // different problem from a wrong token and needs a different fix.
    const detail =
      res.status === 403
        ? 'the token was rejected, which usually means it has already been claimed. Generate a new one on the bridge.'
        : (await res.text()).slice(0, 200)
    throw new SimpleFinError(res.status, `SimpleFIN ${res.status}: ${detail}`)
  }
  return (await res.text()).trim()
}

/** One account as the bridge reports it, already converted. */
export type Account = {
  id: string
  name: string
  org: string
  currency: string
  balanceCents: number
  balanceAt: Date
  transactions: Transaction[]
}

export type Transaction = {
  id: string
  description: string
  amountCents: number
  /** When it hit the account. Falls back to `transacted_at` while pending. */
  occurredOn: Date
  pending: boolean
}

type RawTransaction = {
  id: string
  posted: number
  amount: string
  description?: string
  payee?: string
  memo?: string
  transacted_at?: number
  pending?: boolean
}

type RawAccount = {
  id: string
  name: string
  currency: string
  balance: string
  'balance-date': number
  org?: { name?: string; domain?: string }
  transactions?: RawTransaction[]
}

type AccountSet = {
  accounts?: RawAccount[]
  /** Version 2 calls it errlist. Version 1 called it errors. Both are handled. */
  errlist?: { code: string; msg: string }[]
  errors?: string[]
}

/**
 * A decimal string of currency into integer cents.
 *
 * The protocol sends "-32.45", not -3245, and the column is bigint cents. One
 * multiply and a round is exact for any amount this app will ever see: the
 * classic float problem is accumulating additions, not a single scale of a
 * parsed literal. Rounding is what turns 32.45 * 100 = 3244.9999999999995 back
 * into 3245.
 */
export function toCents(amount: string): number {
  const text = String(amount).trim()
  // Number('') is 0, not NaN, so an empty amount would post as a real
  // transaction of zero rather than being rejected. Whitespace is the only
  // input this catches that the Number check does not.
  if (text === '') throw new SimpleFinError(0, 'SimpleFIN sent an empty amount.')

  const n = Number(text)
  if (!Number.isFinite(n)) {
    throw new SimpleFinError(0, `SimpleFIN sent an amount that is not a number: ${amount}`)
  }
  return Math.round(n * 100)
}

/**
 * A guess at the account kind from its name, because SimpleFIN does not say.
 *
 * The protocol has no type field, so this is the only signal available short
 * of asking the owner. Wrong guesses are cheap and correctable: `kind` drives
 * grouping on the screen, not arithmetic. Net worth is a plain sum either way.
 */
export function inferKind(
  name: string,
): 'checking' | 'savings' | 'brokerage' | 'retirement' | 'credit' | 'crypto' | 'other' {
  const s = name.toLowerCase()
  if (/\b(401|403b|ira|roth|pension|retirement)\b/.test(s)) return 'retirement'
  if (/\b(visa|mastercard|amex|credit|card)\b/.test(s)) return 'credit'
  if (/\b(brokerage|invest|taxable|securities)\b/.test(s)) return 'brokerage'
  if (/\b(crypto|bitcoin|btc|eth|coinbase)\b/.test(s)) return 'crypto'
  if (/\b(savings|save|money market|hysa)\b/.test(s)) return 'savings'
  if (/\b(checking|chequing|current|debit)\b/.test(s)) return 'checking'
  return 'other'
}

const epoch = (seconds: number) => new Date(seconds * 1000)

/**
 * Accounts and their transactions since `since`.
 *
 * `errlist` is surfaced rather than thrown on: SimpleFIN returns 200 with a
 * partial account set when one institution is down, and throwing away four
 * working banks because the fifth needs reauthentication is the wrong trade.
 * The caller decides what to do with the warnings.
 */
export async function accounts(
  since: Date,
  accessUrl?: string,
): Promise<{ accounts: Account[]; warnings: string[] }> {
  const base = accessUrl ?? (await getCredentials('simplefin'))?.access_url
  if (!base) {
    throw new SimpleFinError(0, 'SimpleFIN is not connected. Connect it on Settings > Connections.')
  }

  // The credentials live in the URL's userinfo. fetch() will not send those, so
  // they move to an Authorization header and the URL goes out clean.
  const url = new URL(`${base.replace(/\/+$/, '')}/accounts`)
  const auth = url.username
    ? `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`
    : undefined
  url.username = ''
  url.password = ''
  url.searchParams.set('start-date', String(Math.floor(since.getTime() / 1000)))
  url.searchParams.set('pending', '1')

  const res = await fetch(url, {
    headers: auth ? { Authorization: auth } : {},
    signal: AbortSignal.timeout(60_000),
  })

  if (!res.ok) {
    const detail =
      res.status === 402
        ? 'payment required. The bridge subscription has lapsed.'
        : res.status === 403
          ? 'the access URL was rejected. Reconnect with a new setup token.'
          : (await res.text()).slice(0, 200)
    throw new SimpleFinError(res.status, `SimpleFIN ${res.status}: ${detail}`)
  }

  return parseAccounts((await res.json()) as AccountSet)
}

/**
 * The protocol's shape into this module's.
 *
 * **The sign is flipped here.** SimpleFIN says "positive numbers indicate money
 * being deposited into the account"; this schema says positive is money out
 * (migration 20260909020000, and modules/finance/money.ts). Storing the bank's
 * sign unchanged inverted every purchase: budgets summed to nothing, recurring
 * detection skipped every real charge as income, and a deposit was an unusual
 * charge. One negation at the boundary is the whole fix, and nothing
 * downstream has to know the bank's convention.
 *
 * The balance is not flipped: a card owed is negative in both conventions, and
 * net worth is a plain sum over balances.
 */
export function parseAccounts(body: AccountSet): { warnings: string[]; accounts: Account[] } {
  const warnings = [...(body.errlist ?? []).map((e) => e.msg), ...(body.errors ?? [])]

  return {
    warnings,
    accounts: (body.accounts ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      org: a.org?.name ?? a.org?.domain ?? '',
      currency: a.currency,
      balanceCents: toCents(a.balance),
      balanceAt: epoch(a['balance-date']),
      transactions: (a.transactions ?? []).map((t) => ({
        id: t.id,
        // payee and memo are optional extras some institutions send. The
        // categoriser reads whichever string is richest, so prefer them.
        description: t.payee || t.description || t.memo || '',
        amountCents: -toCents(t.amount),
        // `posted` is 0 while a transaction is pending, and epoch(0) is 1970,
        // which would file it under the Nixon administration.
        occurredOn: epoch(t.posted || t.transacted_at || Math.floor(Date.now() / 1000)),
        pending: t.pending === true || t.posted === 0,
      })),
    })),
  }
}
