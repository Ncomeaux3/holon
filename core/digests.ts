import { db } from './db'
import { getModules, type ModuleManifest } from './modules'

// Every module writes one digest a night. The orchestrator reads digests only,
// never a module's own tables, which is what keeps it from having to know
// anything about any of them.

export type Digest = { module: string; runAt: Date; payload: Record<string, unknown> }

/**
 * Runs one module's get_digest and stores the result. Nightly for every
 * module, and again after every write tool (core/tools.ts) so a dashboard tile
 * shows this minute's numbers rather than last night's.
 */
export async function writeDigest(manifest: ModuleManifest): Promise<boolean> {
  const tool = manifest.tools.get_digest
  // The contract says every module ships one, but a half-built module in a
  // fork should not take the whole run down.
  if (!tool) return false

  const payload = await tool.run({}, { source: 'agent' })
  await db().query(
    `insert into core.digests (module, payload) values ($1, $2::jsonb)`,
    [manifest.id, JSON.stringify(payload ?? {})],
  )
  return true
}

/** Runs every module's get_digest and stores the result. */
export async function writeDigests(): Promise<{ written: string[] }> {
  const written: string[] = []
  for (const manifest of getModules()) {
    if (await writeDigest(manifest)) written.push(manifest.id)
  }
  return { written }
}

/**
 * Thins the table: every row from the last two days stays, and past that only
 * the newest per module per day. The per-write digest adds a row each time
 * the owner touches anything, and digestsBefore(7) needs last week's row, not
 * last week's hundred rows.
 */
export async function pruneDigests(): Promise<{ deleted: number }> {
  const { rowCount } = await db().query(
    `delete from core.digests d
      using (
        select id, row_number() over (partition by module, run_at::date order by run_at desc) as rn
          from core.digests
         where run_at < now() - interval '2 days'
      ) ranked
      where d.id = ranked.id and ranked.rn > 1`,
  )
  return { deleted: rowCount ?? 0 }
}

/**
 * The latest digest per module.
 *
 * This is also the cross-module read mechanism: a screen that needs a number
 * another module owns reads it from here rather than reaching into that
 * module's schema. Health's insurance deductible and Home's mortgage balance
 * both arrive this way.
 */
export async function latestDigests(): Promise<Digest[]> {
  const { rows } = await db().query<{ module: string; run_at: Date; payload: Record<string, unknown> }>(
    `select distinct on (module) module, run_at, payload
       from core.digests
      order by module, run_at desc`,
  )
  return rows.map((r) => ({ module: r.module, runAt: r.run_at, payload: r.payload }))
}

/**
 * The newest digest per module from before a cutoff, for a comparison.
 *
 * The table is append only, so last week's numbers are still in it and a
 * week-over-week delta is a read rather than a stored figure. A module with no
 * digest that old is simply absent, and the screen shows a number with no
 * delta rather than a delta against zero.
 */
export async function digestsBefore(days: number): Promise<Digest[]> {
  const { rows } = await db().query<{ module: string; run_at: Date; payload: Record<string, unknown> }>(
    `select distinct on (module) module, run_at, payload
       from core.digests
      where run_at < now() - make_interval(days => $1)
      order by module, run_at desc`,
    [days],
  )
  return rows.map((r) => ({ module: r.module, runAt: r.run_at, payload: r.payload }))
}

export async function getDigest(module: string): Promise<Record<string, unknown> | null> {
  const { rows } = await db().query<{ payload: Record<string, unknown> }>(
    `select payload from core.digests where module = $1 order by run_at desc limit 1`,
    [module],
  )
  return rows[0]?.payload ?? null
}
