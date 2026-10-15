import { db } from './db'

// The `<module>.query` tool: arbitrary SQL from an agent, run as a role that
// cannot write.
//
// Two layers, and the order matters. The role is the guarantee: pos_readonly
// holds SELECT on core and each module schema and no write grant anywhere, so
// a mutation fails in Postgres no matter what reaches it. The checks below are
// there to refuse early with a message an agent can act on, and to close the
// one thing the role does not: a data-modifying CTE is a legal SELECT
// statement by shape, and Postgres will happily run it.

const FORBIDDEN = [
  'insert',
  'update',
  'delete',
  'drop',
  'alter',
  'create',
  'truncate',
  'grant',
  'revoke',
  'copy',
  'call',
  'merge',
  'vacuum',
  'refresh',
  'reindex',
  'listen',
  'notify',
  'set',
  'reset',
  'begin',
  'commit',
  'rollback',
  'prepare',
  'execute',
  'lock',
]

/**
 * Strip what a keyword could hide behind: string literals, dollar quotes, and
 * both comment styles. Everything left is structure, so a keyword found in it
 * is a real keyword rather than someone's note title.
 */
function structureOnly(sql: string): string {
  return sql
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/'(?:[^']|'')*'/g, ' ')
    .replace(/"(?:[^"]|"")*"/g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
}

/**
 * Refuse a query that names another module's schema.
 *
 * The role cannot enforce this and should not: pos_readonly reads every module
 * schema by design, which is what lets core.search span them. So the scoping a
 * per-module query tool promises has to happen here. Only prefixes matching a
 * real other-module schema are rejected, because telling `finance.tx` from the
 * alias in `select n.title from notes.note n` needs a parser, and the alias is
 * the common case.
 */
export function assertSchemas(sql: string, forbidden: string[]): void {
  // Unquote before stripping. `"finance"."tx"` is two quoted identifiers, and
  // the literal stripper below would remove them whole, hiding the schema.
  const bare = sql
    .replace(/"([^"]*)"/g, '$1')
    .replace(/'(?:[^']|'')*'/g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')

  for (const schema of forbidden) {
    const escaped = schema.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${escaped}\\s*\\.`, 'i').test(bare)) {
      throw new Error(
        `Query may not read the ${schema} schema. This tool reads its own module and core; use ${schema}.query for that module, or core.search to span both.`,
      )
    }
  }
}

/** Throws unless this is a single read-only statement. */
export function assertReadOnly(sql: string): void {
  // U&"\\0066inance" is a legal way to spell finance that no text match will
  // ever see, which defeats assertSchemas below. Refuse the syntax rather than
  // write a decoder for it: nothing an agent legitimately queries needs it.
  if (/\bU&\s*['"]/i.test(sql)) {
    throw new Error('Query may not use Unicode escape syntax (U&"..."). Write the name directly.')
  }

  const bare = structureOnly(sql).trim()
  if (bare === '') throw new Error('Query is empty.')

  // Trailing semicolon is fine; one in the middle means a second statement.
  const withoutTrailing = bare.replace(/;\s*$/, '')
  if (withoutTrailing.includes(';')) {
    throw new Error('Query must be a single statement, and this is more than one statement.')
  }

  // Named verb before shape: telling someone who wrote DELETE that a query
  // must start with SELECT is true and useless. Multi-statement is checked
  // first because it is the more precise diagnosis when both are true.
  for (const word of FORBIDDEN) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(withoutTrailing)) {
      throw new Error(
        `Query may not contain ${word.toUpperCase()}. The query tool reads; use the module's write tool to change anything.`,
      )
    }
  }

  if (!/^(select|with)\b/i.test(withoutTrailing)) {
    throw new Error('Query must start with SELECT or WITH.')
  }
}

/**
 * Wrap rather than append. Appending `limit 500` to a query that already ends
 * in `limit 10000` does nothing, and detecting whether an existing limit is the
 * outer one means parsing SQL. A subquery caps whatever is inside it.
 */
export function capRows(sql: string, maxRows: number): string {
  const inner = sql.trim().replace(/;\s*$/, '')
  return `select * from (${inner}) as capped limit ${maxRows}`
}

export type QueryOptions = {
  /** Hard ceiling on rows returned. */
  maxRows?: number
  /** Statement timeout. An agent's query must not hold a connection open. */
  timeoutMs?: number
  /** Schemas this query may not name. The other modules, for a module's query tool. */
  forbiddenSchemas?: string[]
}

/**
 * Run one read as pos_readonly. Postgres errors are allowed to surface: an
 * agent that reached outside its grants should be told so, in the database's
 * own words, rather than handed a generic failure.
 */
export async function runQuery<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  opts: QueryOptions = {},
): Promise<T[]> {
  assertReadOnly(sql)
  if (opts.forbiddenSchemas?.length) assertSchemas(sql, opts.forbiddenSchemas)

  const maxRows = Math.min(opts.maxRows ?? 500, 1000)
  const timeoutMs = Math.min(opts.timeoutMs ?? 5000, 15_000)

  const client = await db().connect()
  try {
    await client.query('begin')
    // Transaction local, so neither the role nor the timeout can leak into the
    // next user of this pooled connection.
    await client.query('set local role pos_readonly')
    await client.query(`set local statement_timeout = ${timeoutMs}`)
    const { rows } = await client.query<T>(capRows(sql, maxRows))
    return rows
  } finally {
    await client.query('rollback')
    client.release()
  }
}
