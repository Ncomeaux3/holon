'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
import { callTool, ToolInputError, type CallResult } from '@/core/tools'
import { listTransactions, transactionItem } from '../data'

// Server actions are standalone POST endpoints addressed by id, so the (app)
// layout does not run for them and each one authenticates independently.

export type ActionResult = { ok: true } | { ok: false; error: string; fields?: Record<string, string> }

function failed(error: unknown): ActionResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : 'Failed',
    ...(error instanceof ToolInputError && { fields: error.fields }),
  }
}

function done(): ActionResult {
  revalidatePath('/finance')
  revalidatePath('/', 'layout')
  return { ok: true }
}

/**
 * Search the whole ledger, newest first. A read, so it skips callTool: the
 * Transactions tab loads the newest rows only and a search has to reach the
 * rest.
 */
export async function searchTransactions(
  q: string,
): Promise<{ rows: ReturnType<typeof transactionItem>[]; more: boolean }> {
  await requireOwner()
  // One past the cap, so the screen can say there are more than it shows.
  const rows = await listTransactions({ search: q, limit: SEARCH_CAP + 1 })
  return { rows: rows.slice(0, SEARCH_CAP).map(transactionItem), more: rows.length > SEARCH_CAP }
}

const SEARCH_CAP = 200

/**
 * Recategorise a transaction. The rule is offered afterwards, not learned
 * here: SPEC v1.2 says a manual category offers to become a rule.
 *
 * source 'ui' on purpose: `categorise` is unguarded, but going through callTool
 * keeps one implementation shared with MCP, and the owner pressing a button in
 * their own app is already the approval.
 */
export async function recategorise(id: string, categoryId: string): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('finance', 'categorise', { id, category_id: categoryId, learn: false }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

/** Tag a row to a trip, confirm the suggestion, or clear it with null (v1.2 phase 10b). */
export async function setTrip(id: string, tripRef: string | null): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('finance', 'set_trip', { id, trip_ref: tripRef }, { source: 'ui' })
    revalidatePath('/travel')
    return done()
  } catch (error) {
    return failed(error)
  }
}

/** "Always file {merchant} as {category}": the offer under a filed row. */
export async function learnFor(id: string, categoryId: string): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('finance', 'learn_rule', { transaction_id: id, category_id: categoryId }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

/**
 * How many rows a rule moved, out of the tool's result. Neither rule tool is
 * guarded, so `proposed` never happens here; reading it as zero is still the
 * honest answer if one ever were.
 */
function movedIn(result: CallResult): number {
  if (result.status !== 'done') return 0
  const moved = (result.result as { moved?: unknown }).moved
  return typeof moved === 'number' ? moved : 0
}

/**
 * Write or change a rule. The count comes back so the drawer can say how many
 * rows moved: a back-file changes past budgets, and doing that silently would
 * be the surprise this phase exists to avoid.
 */
export async function saveRule(
  pattern: string,
  categoryId: string,
  id?: string,
): Promise<ActionResult & { moved?: number }> {
  await requireOwner()
  try {
    const result = await callTool(
      'finance',
      'write_rule',
      { ...(id && { id }), pattern, category_id: categoryId },
      { source: 'ui' },
    )
    return { ...done(), moved: movedIn(result) }
  } catch (error) {
    return failed(error)
  }
}

export async function deleteRule(id: string): Promise<ActionResult & { moved?: number }> {
  await requireOwner()
  try {
    const result = await callTool('finance', 'delete_rule', { id }, { source: 'ui' })
    return { ...done(), moved: movedIn(result) }
  } catch (error) {
    return failed(error)
  }
}

export async function saveCashFlowAccounts(accountIds: string[]): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('finance', 'set_cash_flow_accounts', { account_ids: accountIds }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function saveCountPending(on: boolean): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('finance', 'set_count_pending', { on }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function saveChartMonths(months: number): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('finance', 'set_chart_months', { months }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

/** Limits are in dollars on screen and cents in the database. Converted once, here. */
export async function saveBudget(categoryId: string, limitDollars: number): Promise<ActionResult> {
  await requireOwner()

  if (!Number.isFinite(limitDollars) || limitDollars <= 0) {
    return { ok: false, error: 'A limit has to be a positive number' }
  }

  try {
    await callTool(
      'finance',
      'set_budget',
      { category_id: categoryId, limit_cents: Math.round(limitDollars * 100) },
      { source: 'ui' },
    )
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function saveThreshold(percent: number): Promise<ActionResult> {
  await requireOwner()
  if (!Number.isInteger(percent) || percent < 50 || percent > 100) {
    return { ok: false, error: 'The threshold is a whole percentage from 50 to 100' }
  }
  try {
    await callTool('finance', 'set_alert_threshold', { percent }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

export async function setSubscriptionStatus(
  id: string,
  status: 'active' | 'paused' | 'cancelled',
): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('finance', 'write_subscription', { id, status }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}
