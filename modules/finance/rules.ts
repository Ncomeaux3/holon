import { db } from '@/core/db'
import { BUILTIN_RULES, categorise, learnFrom, matchRefund, normalise, type Rule } from './categorise'

// v1.2 phase 5c. The one place that answers which rows a rule touches.
//
// Before this file a rule only ever decided what the next sync would do, so a
// rule written today said nothing about the 607 rows already in the ledger and
// a wrong rule was unreachable. Writing, editing or deleting one now re-files
// the history it matches, and that is the only way the backlog clears.
//
// Two invariants hold everywhere below. A row with `is_manual = true` is never
// written: the owner's correction is the fact no job may overwrite. And a
// re-file runs the *whole* ranked rule set over a row rather than forcing the
// one rule that occasioned it, so a short new rule cannot steal a row a longer
// one owns and deleting one rule hands its rows to whatever matches next
// instead of orphaning them.

export type RuleSet = {
  /** Learned rules then the built-ins, in the shape categorise() ranks. */
  rules: Rule[]
  /** Category name to id, for writing the match back. */
  byName: Map<string, string>
  /** The owner's card institutions, so "CAPITAL ONE ONLINE PMT" is a payment. */
  institutions: string[]
  /** Recent card charges, for matchRefund: money back nets against its charge. */
  charges: { merchant: string; amountCents: number; category: string | null }[]
}

/** A row as both classifiers want it. */
export type Classifiable = {
  descriptor: string
  merchant: string
  amountCents: number
  accountKind: string
}

/**
 * The one answer to "what is this row".
 *
 * Rules first, then the refund matcher, which is the order the nightly sweep
 * has always used. It is shared so a back-file and the sweep cannot disagree:
 * re-running only the rules here would clear a refund that `matchRefund` had
 * filed, and once its charge fell out of the 90 day window nothing would ever
 * file it again.
 */
export function classify(row: Classifiable, set: RuleSet): string | null {
  return (
    categorise(row.descriptor, set.rules, set.institutions)?.category ??
    matchRefund(row, set.charges)
  )
}

/** Everything categorise() needs, read once and passed down. */
export async function loadRuleSet(): Promise<RuleSet> {
  const [{ rows: ruleRows }, { rows: categoryRows }, { rows: institutionRows }, { rows: chargeRows }] =
    await Promise.all([
      db().query<{ category: string; pattern: string; isManual: boolean }>(
        `select c.name as category, r.pattern, r.is_manual as "isManual"
           from finance.category_rule r
           join finance.category c on c.id = r.category_id`,
      ),
      db().query<{ id: string; name: string }>(`select id, name from finance.category`),
      db().query<{ institution: string }>(
        `select distinct institution from finance.account
          where kind = 'credit' and archived = false and institution <> ''`,
      ),
      db().query<{ merchant: string; amount_cents: string; category: string | null }>(
        `select t.merchant, t.amount_cents::text, c.name as category
           from finance.transaction t
           join finance.account a on a.id = t.account_id
           left join finance.category c on c.id = t.category_id
          where a.kind = 'credit' and t.amount_cents > 0
            and t.occurred_on >= core.today() - 90
          order by t.occurred_on desc`,
      ),
    ])

  return {
    // Learned first, then the built-ins. The sort inside categorise() is what
    // actually ranks them; this order only decides ties it leaves alone.
    rules: [...ruleRows, ...BUILTIN_RULES],
    byName: new Map(categoryRows.map((c) => [c.name, c.id])),
    institutions: institutionRows.map((r) => r.institution),
    charges: chargeRows.map((r) => ({
      merchant: r.merchant,
      amountCents: Number(r.amount_cents),
      category: r.category,
    })),
  }
}

/**
 * The SQL twin of normalise() in categorise.ts: lowercase, punctuation to
 * spaces, runs collapsed, trimmed. It has to agree with the TypeScript one or
 * the rows this selects are not the rows categorise() then matches.
 *
 * Safe in a LIKE without escaping because every pattern is normalised before
 * it is stored, so `%` and `_` cannot survive into one.
 */
const NORMALISED = `trim(regexp_replace(lower(t.descriptor), '[^a-z0-9]+', ' ', 'g'))`

/**
 * Re-file every automatic row whose descriptor contains this pattern.
 *
 * A row nothing claims any more is cleared rather than left pointing at the
 * deleted rule's category. Both classifiers run, not only the rules: a refund
 * `matchRefund` had filed can contain a deleted rule's pattern, and clearing
 * it would be permanent once its charge left the 90 day window.
 */
export async function refile(pattern: string, set?: RuleSet): Promise<number> {
  const normalised = normalise(pattern)
  if (normalised === '') return 0

  const loaded = set ?? (await loadRuleSet())

  const { rows } = await db().query<{
    id: string
    descriptor: string
    merchant: string
    amount_cents: string
    account_kind: string
    category_id: string | null
  }>(
    `select t.id, t.descriptor, t.merchant, t.amount_cents::text,
            a.kind as account_kind, t.category_id
       from finance.transaction t
       join finance.account a on a.id = t.account_id
      where t.is_manual = false
        -- A superset for a three letter pattern, which matches as a whole
        -- word: classify() below is what decides, and only a change counts.
        and ${NORMALISED} like '%' || $1 || '%'`,
    [normalised],
  )

  let moved = 0
  for (const row of rows) {
    const name = classify(
      {
        descriptor: row.descriptor,
        merchant: row.merchant,
        amountCents: Number(row.amount_cents),
        accountKind: row.account_kind,
      },
      loaded,
    )
    const next = name === null ? null : (loaded.byName.get(name) ?? null)
    if (next === row.category_id) continue

    await db().query(
      `update finance.transaction
          set category_id = $2,
              classified_by = case when $2::uuid is null then null else 'rule' end,
              confidence = case when $2::uuid is null then null else 1 end
        where id = $1 and is_manual = false`,
      [row.id, next],
    )
    moved++
  }

  return moved
}

/** How many rows this pattern moves, once the rule behind it is in the table. */
export async function applyRule(pattern: string): Promise<number> {
  return refile(pattern)
}

/**
 * Delete a rule and hand its rows to whatever matches next.
 *
 * The rows are found by the pattern rather than by the category, because a row
 * two rules matched belongs to the other one now and re-running the set is the
 * only way to know which.
 */
export async function removeRule(id: string): Promise<number> {
  const { rows } = await db().query<{ pattern: string }>(
    `delete from finance.category_rule where id = $1 returning pattern`,
    [id],
  )
  if (rows.length === 0) return 0
  return refile(rows[0].pattern)
}

export type Unfiled = {
  /** The pattern a rule would be written on, which is what File writes. */
  pattern: string
  /** A descriptor the owner will recognise, for the row's label. */
  label: string
  count: number
  totalCents: number
  /** Newest first, so the owner can see which way the money went before filing. */
  rows: UnfiledRow[]
}

export type UnfiledRow = {
  descriptor: string
  /** Positive is money out, negative is money in: the ledger's sign. */
  amountCents: number
  occurredOn: string
  account: string
}

/**
 * Uncategorised rows collapsed onto the pattern a rule would use.
 *
 * Grouped on learnFrom()'s pattern and not on the stored merchant: the merchant
 * still carries the store number, so "kroger 412" and "kroger 118" are two
 * merchants and one rule. Biggest money first, because that is the order in
 * which filing one is worth the click.
 */
export function groupUnfiled(
  rows: (UnfiledRow & { merchant: string })[],
): Unfiled[] {
  const groups = new Map<string, Unfiled>()

  for (const row of rows) {
    // A descriptor with nothing learnable left (all digits, or too short to be
    // safe) still deserves a line, under the merchant it came with.
    const pattern = learnFrom(row.descriptor, '')?.pattern ?? row.merchant
    if (pattern === '') continue

    const group = groups.get(pattern) ?? { pattern, label: row.descriptor, count: 0, totalCents: 0, rows: [] }
    group.count++
    group.totalCents += row.amountCents
    group.rows.push({
      descriptor: row.descriptor,
      amountCents: row.amountCents,
      occurredOn: row.occurredOn,
      account: row.account,
    })
    groups.set(pattern, group)
  }

  return [...groups.values()].sort((a, b) => b.totalCents - a.totalCents)
}

/**
 * What the rules could not file, for the drawer's Unfiled list.
 *
 * Every group, not a top hundred: 172 merchants behind a cap of 100 would be
 * 72 the owner cannot reach, which is the bug this phase exists to fix. The
 * read below is what bounds the work.
 */
export async function unfiledMerchants(): Promise<Unfiled[]> {
  const { rows } = await db().query<{
    descriptor: string
    merchant: string
    amount_cents: string
    occurred_on: string
    account: string
  }>(
    // Newest first so the label is a descriptor the owner saw recently. The
    // bound is well past the owner's whole ledger and is there so one bad pull
    // cannot turn this read into the page's slowest query.
    `select t.descriptor, t.merchant, t.amount_cents::text,
            t.occurred_on::text, a.name as account
       from finance.transaction t
       join finance.account a on a.id = t.account_id
      where t.category_id is null and t.is_manual = false
      order by t.occurred_on desc
      limit 5000`,
  )

  return groupUnfiled(
    rows.map((r) => ({
      descriptor: r.descriptor,
      merchant: r.merchant,
      amountCents: Number(r.amount_cents),
      occurredOn: r.occurred_on,
      account: r.account,
    })),
  )
}
