import { db } from '@/core/db'
import { getCredentials } from '@/core/credentials'
import { register } from '@/core/entities'
import { accounts, inferKind, SimpleFinError, type Account } from '@/integrations/simplefin/client'
import { normalise } from '../categorise'

// Pull balances and transactions from SimpleFIN. Runs first in the nightly
// order, because categorise, detect_subscriptions and the digest all read what
// it wrote.
//
// It writes rows and nothing else. No register(), deliberately: the module
// already decided that the event worth recording is the categorising, not the
// transaction, because importing a month of history is not a month of work.
// That decision also keeps a bank import off the classification path entirely.
// An account is the exception, registered with no event and no classifying, so
// a loyalty program can name the card that earns it (v1.2 phase 10b).

export type SyncResult = {
  skipped: boolean
  accounts: number
  transactions: number
  /** Accounts passed over because their currency is not the one net worth sums. */
  skippedAccounts: string[]
  /** What the bridge said went wrong at an institution it could not reach. */
  warnings: string[]
  /**
   * What came back per account, with the oldest date. The history limit is the
   * institution's, not the bridge's: a 90 day pull can return less, and the
   * count is the honest number rather than a claim of 90.
   */
  perAccount: { name: string; transactions: number; oldest: string | null }[]
  detail: string
}

/**
 * How far back a first sync asks for.
 *
 * Long enough for `detectRecurring` to have something to work with: it needs
 * several cycles of the same merchant to call a charge recurring, and a
 * fortnight of history would find nothing.
 */
const FIRST_RUN_DAYS = 90

/**
 * Re-ask window on every later run.
 *
 * A pending transaction changes when it posts: the amount can move and the
 * date certainly does. Asking for the last month every night is what lets an
 * upsert correct one rather than leaving the pending copy behind forever.
 */
const OVERLAP_DAYS = 30

/**
 * The one currency this schema can hold.
 *
 * `finance.account` has no currency column and net worth is a plain sum over
 * `balance_cents`, so a euro account would be added to a dollar account as
 * though they were the same unit. Skipping is the honest option: the number on
 * the dashboard stays true, and the sync says out loud what it left out.
 */
const CURRENCY = 'USD'

async function since(days?: number): Promise<Date> {
  if (days === undefined) {
    const { rows } = await db().query<{ latest: string | null }>(
      `select max(occurred_on)::text as latest from finance.transaction where source = 'simplefin'`,
    )
    days = rows[0]?.latest ? OVERLAP_DAYS : FIRST_RUN_DAYS
  }
  return new Date(Date.now() - days * 86_400_000)
}

/** The connection row, so an account knows which credential syncs it. */
async function connectionId(): Promise<string | null> {
  const { rows } = await db().query<{ id: string }>(
    `select id from core.connections where integration_id = 'simplefin' limit 1`,
  )
  return rows[0]?.id ?? null
}

export async function storeAccount(a: Account, connection: string | null): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into finance.account
       (name, institution, kind, in_cash_flow, balance_cents, mask, connection_id, source, external_id, synced_at)
     -- in_cash_flow from the kind on insert only, as the migration set it, and
     -- left out of the update below with kind: the owner decides it after that.
     values ($1, $2, $3, $3::text not in ('brokerage', 'retirement', 'crypto', 'other'),
             $4, $5, $6, 'simplefin', $7, now())
     on conflict (source, external_id) do update
       set name = excluded.name,
           institution = excluded.institution,
           balance_cents = excluded.balance_cents,
           connection_id = excluded.connection_id,
           synced_at = now(),
           updated_at = now()
     returning id`,
    [
      a.name,
      a.org,
      inferKind(a.name),
      a.balanceCents,
      // The bridge sends no account number, which is the correct amount of
      // account number to send. A trailing group of digits in the name is the
      // only mask available, and no mask is better than a wrong one.
      a.name.match(/(\d{4})\s*$/)?.[1] ?? '',
      connection,
      a.id,
    ],
  )

  // The kind is guessed from the name and the owner may have corrected it, so
  // it is set on insert only. `do update` above deliberately omits it.
  await register({ module: 'finance', entityType: 'account', entityId: rows[0].id, title: a.name, emit: false, classify: false })
  return rows[0].id
}

async function storeTransactions(accountId: string, a: Account): Promise<number> {
  let written = 0

  for (const t of a.transactions) {
    await db().query(
      `insert into finance.transaction
         (account_id, descriptor, merchant, amount_cents, occurred_on, pending,
          source, external_id)
       values ($1, $2, $3, $4, $5, $6, 'simplefin', $7)
       on conflict (source, external_id) do update
         set descriptor = excluded.descriptor,
             merchant = excluded.merchant,
             amount_cents = excluded.amount_cents,
             occurred_on = excluded.occurred_on,
             pending = excluded.pending,
             updated_at = now()
       -- The category is not in the update list at all, so a correction the
       -- owner made survives the pending row posting and changing shape.
       where finance.transaction.is_manual = false`,
      [
        accountId,
        t.description,
        normalise(t.description),
        t.amountCents,
        t.occurredOn.toISOString().slice(0, 10),
        t.pending,
        t.id,
      ],
    )
    written++
  }

  return written
}

/** The Pull 90 days button's window, and the doc's name for it. */
export const PULL_DAYS = FIRST_RUN_DAYS

/**
 * Never throws for a provider problem. A bank being down must not fail the
 * nightly run, and the job runner records the outcome either way.
 *
 * `days` overrides the window: the nightly run leaves it out, the Pull 90 days
 * button passes PULL_DAYS.
 */
export async function syncSimpleFin(opts: { days?: number } = {}): Promise<SyncResult> {
  if (!(await getCredentials('simplefin'))?.access_url) {
    return {
      skipped: true,
      accounts: 0,
      transactions: 0,
      skippedAccounts: [],
      warnings: [],
      perAccount: [],
      detail: 'SimpleFIN is not connected.',
    }
  }

  const from = await since(opts.days)
  const connection = await connectionId()

  let found
  try {
    found = await accounts(from)
  } catch (error) {
    if (error instanceof SimpleFinError) {
      return {
        skipped: true,
        accounts: 0,
        transactions: 0,
        skippedAccounts: [],
        warnings: [error.message],
        perAccount: [],
        detail: error.message,
      }
    }
    throw error
  }

  const skippedAccounts: string[] = []
  const perAccount: SyncResult['perAccount'] = []
  let transactionCount = 0

  for (const a of found.accounts) {
    if (a.currency !== CURRENCY) {
      skippedAccounts.push(`${a.name} (${a.currency})`)
      continue
    }
    const id = await storeAccount(a, connection)
    const written = await storeTransactions(id, a)
    transactionCount += written
    const oldest = a.transactions.map((t) => t.occurredOn.toISOString().slice(0, 10)).sort()[0] ?? null
    perAccount.push({ name: a.name, transactions: written, oldest })
  }

  const parts = [`${perAccount.length} accounts, ${transactionCount} transactions`]
  if (perAccount.length > 0) {
    parts.push(
      perAccount
        .map((p) => `${p.name} ${p.transactions}${p.oldest ? ` since ${p.oldest}` : ''}`)
        .join(', '),
    )
  }
  if (skippedAccounts.length > 0) parts.push(`skipped ${skippedAccounts.join(', ')}`)
  if (found.warnings.length > 0) parts.push(found.warnings.join('; '))

  return {
    skipped: false,
    accounts: perAccount.length,
    transactions: transactionCount,
    skippedAccounts,
    warnings: found.warnings,
    perAccount,
    detail: parts.join('. '),
  }
}
