import { db } from './db'
import { writeDigest } from './digests'
import { getModule } from './modules'

// What an agent wants to do, held until the owner decides. Nothing here touches
// a module's tables: approving does, by calling the tool the proposal names.

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'dismissed'

export type DiffEntry = { field: string; before: string | null; after: string | null }

export type Proposal = {
  id: string
  module: string
  tool: string
  payload: Record<string, unknown>
  title: string | null
  agent: string | null
  reason: string | null
  confidence: number | null
  evidence: string | null
  affects: string | null
  guarded: boolean
  diff: DiffEntry[]
  status: ProposalStatus
  createdAt: Date
  decidedAt: Date | null
}

/** How long a dismissal holds before the same proposal may come back. */
const DISMISS_DAYS = 30

const COLUMNS = `id, module, tool, payload, title, agent, reason, confidence, evidence,
                 affects, guarded, diff, status, created_at as "createdAt",
                 decided_at as "decidedAt"`

export async function propose(args: {
  module: string
  tool: string
  payload: Record<string, unknown>
  agent: string
  reason: string
  guarded: boolean
  title?: string
  confidence?: number
  evidence?: string
  affects?: string
  diff?: DiffEntry[]
}): Promise<string> {
  // A dismissal holds for DISMISS_DAYS: the same call proposed again inside
  // the window is the dismissed row, not a new one, so the owner is not asked
  // twice about a thing they already said no to.
  const held = await db().query<{ id: string }>(
    `select id from core.proposals
      where module = $1 and tool = $2 and payload = $3::jsonb
        and status = 'dismissed' and dismissed_until > now()
      limit 1`,
    [args.module, args.tool, JSON.stringify(args.payload)],
  )
  if (held.rows[0]) return held.rows[0].id

  const { rows } = await db().query<{ id: string }>(
    `insert into core.proposals
       (module, tool, payload, agent, reason, guarded, title, confidence, evidence, affects, diff)
     values ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     returning id`,
    [
      args.module,
      args.tool,
      JSON.stringify(args.payload),
      args.agent,
      args.reason,
      args.guarded,
      args.title ?? `${args.module}.${args.tool}`,
      args.confidence ?? null,
      args.evidence ?? null,
      args.affects ?? null,
      JSON.stringify(args.diff ?? []),
    ],
  )
  return rows[0].id
}

export async function getProposal(id: string): Promise<Proposal | null> {
  const { rows } = await db().query<Proposal>(
    `select ${COLUMNS} from core.proposals where id = $1`,
    [id],
  )
  return rows[0] ?? null
}

/**
 * Pending hides anything dismissed and still inside its window, so a dismissal
 * actually quiets the inbox instead of only relabelling the row.
 */
export async function listProposals(status: ProposalStatus): Promise<Proposal[]> {
  const { rows } = await db().query<Proposal>(
    `select ${COLUMNS} from core.proposals
      where status = $1
        and ($1 <> 'pending' or dismissed_until is null or dismissed_until < now())
      order by created_at desc
      limit 100`,
    [status],
  )
  return rows
}

export async function countPending(): Promise<number> {
  const { rows } = await db().query<{ count: string }>(
    `select count(*)::text as count from core.proposals
      where status = 'pending'
        and (dismissed_until is null or dismissed_until < now())`,
  )
  return Number(rows[0].count)
}

/**
 * Run the proposal for real.
 *
 * The tool is called with source 'agent', because that is what it was: the
 * owner approved it, they did not type it. A module that stamps rows by source
 * should still record the agent as the origin.
 *
 * `patch` is the Review screen's inline edit. It is merged over the stored
 * payload and re-validated, so an edited proposal cannot smuggle a shape the
 * tool would reject.
 */
export async function approve(
  id: string,
  patch?: Record<string, unknown>,
): Promise<{ result: unknown }> {
  const proposal = await getProposal(id)
  if (!proposal) throw new Error(`No proposal ${id}`)
  if (proposal.status !== 'pending') throw new Error(`Proposal ${id} is already ${proposal.status}`)

  const manifest = getModule(proposal.module)
  const tool = manifest?.tools[proposal.tool]
  if (!tool) throw new Error(`${proposal.module}.${proposal.tool} no longer exists`)

  const input = tool.input.parse({ ...proposal.payload, ...patch })
  const result = await tool.run(input, { source: 'agent' })

  // The same recompute callTool does after a write, so the dashboard tile
  // reads the approved change straight away. Logged, never a failed approval.
  try {
    await writeDigest(manifest)
  } catch (err) {
    console.error(`${proposal.module}.get_digest failed after approve:`, err)
  }

  // An approved proposal is still an agent write: the owner said yes to it,
  // not that they made it. It belongs in the Agent Log with everything else,
  // and the diff the Review panel showed is the diff that gets logged.
  const { logWrite } = await import('./writelog')
  await logWrite({
    module: proposal.module,
    tool: proposal.tool,
    kind: 'approved',
    title: proposal.title ?? `${proposal.module}.${proposal.tool}`,
    reason: proposal.reason ?? 'Approved from the Review inbox.',
    actor: proposal.agent ?? 'agent',
    diff: proposal.diff,
    applyPayload: input as Record<string, unknown>,
  })

  // Marked only after the write succeeded. A tool that throws leaves the
  // proposal pending, so the owner can see it failed and try again.
  await db().query(
    `update core.proposals
        set status = 'approved', decided_at = now(), payload = $2::jsonb
      where id = $1`,
    [id, JSON.stringify(input)],
  )

  return { result }
}

/** Not this again for a while. Comes back after the window. */
export async function dismiss(id: string): Promise<void> {
  await db().query(
    `update core.proposals
        set status = 'dismissed',
            decided_at = now(),
            dismissed_until = now() + ($2 || ' days')::interval
      where id = $1 and status = 'pending'`,
    [id, DISMISS_DAYS],
  )
}

/** Puts a decided proposal back in the inbox. The Undo on a decided item. */
export async function reopen(id: string): Promise<void> {
  await db().query(
    `update core.proposals
        set status = 'pending', decided_at = null, dismissed_until = null
      where id = $1`,
    [id],
  )
}
