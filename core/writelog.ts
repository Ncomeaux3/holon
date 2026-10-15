import { db } from './db'
import type { Diff, Job } from './writelog-shape'

// Every agent and job write, with the value before it, so the Agent Log can
// show what happened overnight and put any of it back.
//
// UI writes are deliberately absent. Undo for those is the edit form, and
// logging them would double the write path on every screen.
//
// The shape a client renders lives in core/writelog-shape.ts, which imports
// nothing: this file reaches pg and a client component cannot.

export type { Diff, Entry, Run, RunStatus } from './writelog-shape'

export type LogArgs = {
  runId?: string | null
  module: string
  tool: string
  entityRef?: string | null
  /** categorised | flagged | rescheduled | recomputed | classified | created */
  kind: string
  title: string
  /** Why, shown under the title. Never null: an unexplained write cannot be judged. */
  reason: string
  diff?: Diff[]
  actor?: string
  /**
   * The tool input that would put this back. Undo re-runs the same tool with
   * it. Omit when the write cannot describe its own reverse, and the screen
   * offers no Undo rather than a button that does nothing.
   */
  revertPayload?: Record<string, unknown> | null
  /** The call that was made, so Redo can re-apply it. */
  applyPayload?: Record<string, unknown> | null
}

export async function logWrite(args: LogArgs): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into core.write_log
       (run_id, module, tool, entity_ref, kind, title, reason, diff, actor,
        revert_payload, apply_payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11::jsonb)
     returning id`,
    [
      args.runId ?? null,
      args.module,
      args.tool,
      args.entityRef ?? null,
      args.kind,
      args.title,
      args.reason,
      JSON.stringify(args.diff ?? []),
      args.actor ?? 'agent',
      args.revertPayload ? JSON.stringify(args.revertPayload) : null,
      args.applyPayload ? JSON.stringify(args.applyPayload) : null,
    ],
  )
  return rows[0].id
}

type RunRow = {
  id: string
  started_at: Date
  finished_at: Date | null
  status: string
  duration_ms: number | null
  trigger_source: string
  log: { jobs?: Job[] }
}

type EntryRow = {
  id: string
  run_id: string | null
  module: string
  tool: string
  kind: string
  title: string
  reason: string
  diff: Diff[]
  actor: string
  undone_at: Date | null
  created_at: Date
  can_undo: boolean
  can_redo: boolean
}

/**
 * The last few runs with their entries. Two queries rather than a join: a run
 * with no writes still has to appear, because "the agent did nothing" is a
 * thing the log has to be able to say.
 */
export async function listRuns(limit = 7): Promise<{ runs: RunRow[]; entries: EntryRow[] }> {
  const { rows: runs } = await db().query<RunRow>(
    `select id, started_at, finished_at, status, duration_ms, trigger_source, log
       from core.job_runs
      order by started_at desc
      limit $1`,
    [limit],
  )
  if (runs.length === 0) return { runs, entries: [] }

  const { rows: entries } = await db().query<EntryRow>(
    `select id, run_id, module, tool, kind, title, reason, diff, actor,
            undone_at, created_at,
            (revert_payload is not null and undone_at is null) as can_undo,
            (apply_payload is not null and undone_at is not null) as can_redo
       from core.write_log
      where run_id = any($1)
      order by created_at`,
    [runs.map((r) => r.id)],
  )

  return { runs, entries }
}

/** Everything put back, newest first, for the rail's undo history. */
export async function listUndone(limit = 10): Promise<
  { id: string; module: string; title: string; undone_at: Date; rule_paused: boolean }[]
> {
  const { rows } = await db().query<{
    id: string
    module: string
    title: string
    undone_at: Date
    rule_paused: boolean
  }>(
    `select w.id, w.module, w.title, w.undone_at,
            exists (
              select 1 from core.notification_rules r
               where r.module = w.module and r.snooze_until > now()
            ) as rule_paused
       from core.write_log w
      where w.undone_at is not null
      order by w.undone_at desc
      limit $1`,
    [limit],
  )
  return rows
}

/**
 * Put a write back, by calling the same tool with the values from before it.
 *
 * Undo is TypeScript rather than the SQL function the handoff proposes, because
 * a SQL function cannot call a module's write tool: that tool is a closure on a
 * manifest, and the manifest is the only thing that knows how the module wants
 * to be written to. Going through it means undo respects the same validation
 * the original write did.
 *
 * The rule that produced the write is paused for seven days, so the agent does
 * not simply make the same decision again tomorrow night.
 */
export async function undoWrite(id: string): Promise<void> {
  await applyLogged(id, 'undo')
}

/** The other direction. Only for updates: see the note in applyLogged. */
export async function redoWrite(id: string): Promise<void> {
  await applyLogged(id, 'redo')
}

async function applyLogged(id: string, direction: 'undo' | 'redo'): Promise<void> {
  const { rows } = await db().query<{
    module: string
    tool: string
    undone_at: Date | null
    revert_payload: Record<string, unknown> | null
    apply_payload: Record<string, unknown> | null
  }>(
    `select module, tool, undone_at, revert_payload, apply_payload
       from core.write_log where id = $1`,
    [id],
  )
  const entry = rows[0]
  if (!entry) throw new Error('No such write')

  if (direction === 'undo' && entry.undone_at) throw new Error('Already undone')
  if (direction === 'redo' && !entry.undone_at) throw new Error('Nothing to redo')

  const payload = direction === 'undo' ? entry.revert_payload : entry.apply_payload
  if (!payload) {
    throw new Error(
      direction === 'undo'
        ? 'This write did not record how to reverse it'
        : 'This write did not record how to re-apply it',
    )
  }

  // Dynamic for the same reason register() is: a static import of the registry
  // from core closes a cycle through every manifest.
  const { getModule } = await import('./modules')
  const tool = getModule(entry.module)?.tools[entry.tool]
  if (!tool) throw new Error(`${entry.module}.${entry.tool} no longer exists`)

  // 'ui' because the owner pressed the button. Pressing it in your own app is
  // the approval, so this must never become a proposal.
  await tool.run(tool.input.parse(payload), { source: 'ui' })

  await db().query(`update core.write_log set undone_at = $2 where id = $1`, [
    id,
    direction === 'undo' ? new Date() : null,
  ])

  if (direction === 'undo') {
    await db().query(
      `update core.notification_rules
          set snooze_until = now() + interval '7 days'
        where module = $1 and snooze_until is null`,
      [entry.module],
    )
  }
}
