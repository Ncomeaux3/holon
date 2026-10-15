import { db } from '@/core/db'
import type { ToolContext } from '@/core/module-contract'
import { ownerToday } from '@/core/today'
import { callTool } from '@/core/tools'
import { premiumPost, type Cadence } from './premium'

/**
 * Make Finance hold what the policy says about its premium (v1.2 phase 11).
 *
 * Through the tool registry, the only way one module reaches another, with the
 * caller's source carried through: the owner's save posts it directly. Posting
 * off, a policy no longer active, or no expiry to date the charge from all
 * mean Finance holds nothing for it.
 */
export async function postPremium(id: string, ctx: ToolContext): Promise<void> {
  const { rows } = await db().query<{
    name: string
    premium_cents: string
    cadence: Cadence
    expires_on: string | null
    status: string
    post_to_finance: boolean
  }>(
    `select name, premium_cents::text, cadence, expires_on::text, status, post_to_finance
       from insurance.policy where id = $1`,
    [id],
  )
  const post = rows[0]
    ? premiumPost({ id, ...rows[0], premium_cents: Number(rows[0].premium_cents) }, await ownerToday())
    : null
  if (post) {
    await callTool('finance', 'write_recurring', post, { source: ctx.source, agent: 'insurance', reason: REASON })
  } else {
    await unpostPremium(id, ctx)
  }
}

const REASON = 'Insurance keeps the premium in Finance in step with the policy.'

/** Remove the premium from Finance. Delete runs this before the policy row goes, so a failure leaves nothing orphaned. */
export async function unpostPremium(id: string, ctx: ToolContext): Promise<void> {
  await callTool(
    'finance',
    'delete_recurring',
    { source: 'insurance', external_id: id },
    { source: ctx.source, agent: 'insurance', reason: REASON },
  )
}
