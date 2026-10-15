import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { Client } from 'pg'

// The vitest suites delete from core.connections, core.settings, core.entities
// and core.events. Pointed at the development database that wipes the owner's
// real provider keys and preferences, which is exactly what happened on
// 2026-09-08. They get their own database instead.
//
// Dropped and rebuilt from supabase/migrations on every run: two migrations
// replay in well under a second, and no applied-migrations bookkeeping can
// drift out of step with the files.

const MIGRATIONS = path.join(import.meta.dirname, '..', 'supabase', 'migrations')

/**
 * Swap the database name in a Postgres URL, leaving everything else alone.
 * vitest.config.mts derives the same name the same way; see the note there for
 * why it is not imported from here.
 */
function testDatabaseUrl(url: string): string {
  const parsed = new URL(url)
  parsed.pathname = '/pos_test'
  return parsed.toString()
}

async function run(url: string, sql: string) {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    await client.query(sql)
  } finally {
    await client.end()
  }
}

export default async function setup() {
  const devUrl = process.env.DATABASE_URL
  if (!devUrl) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.')

  const adminUrl = new URL(devUrl)
  adminUrl.pathname = '/postgres'

  // force so a stale pool from a previous run cannot block the drop.
  await run(adminUrl.toString(), 'drop database if exists pos_test with (force)')
  await run(adminUrl.toString(), 'create database pos_test')

  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort()
  const target = testDatabaseUrl(devUrl)

  for (const file of files) {
    await run(target, await readFile(path.join(MIGRATIONS, file), 'utf8'))
  }

  console.log(`test database rebuilt from ${files.length} migrations`)
}
