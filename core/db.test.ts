import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Runs against the local Supabase stack. `supabase start` first.
const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const client = new Client({ connectionString: process.env.DATABASE_URL ?? LOCAL_DB })

beforeAll(async () => {
  await client.connect()
})
afterAll(async () => {
  await client.end()
})

// Every table named in the ARCHITECTURE.md core schema table.
const CORE_TABLES = [
  'entities',
  'skill_links',
  'events',
  'notification_rules',
  'reviews',
  'notifications',
  'jobs',
  'digests',
  'dashboard_summary',
  'connections',
  'proposals',
  'embeddings',
  'settings',
  'llm_calls',
  'request_log',
  // Added by 20260908074500_core_platform.sql for the Agent Log and the
  // editable skill tree. This list is the guard against schema drift, so a new
  // core table has to be added here deliberately.
  'job_runs',
  'write_log',
  // 20260909130000_core_push.sql. One row per browser that turned push on.
  'push_subscription',
  // 20260921112126_core_client_errors.sql. What error.tsx posts (v1.2 Phase 2).
  'client_errors',
]

// Columns added after core_init, listed so a dropped migration is caught here
// rather than at runtime. 20260908084500_core_notifications.sql.
const NOTIFICATION_COLUMNS = ['urgency', 'read_at', 'snooze_until', 'digest_run_id']

describe('core schema', () => {
  it('has every table the architecture names, and no others', async () => {
    const { rows } = await client.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'core' order by tablename`,
    )
    expect(rows.map((r) => r.tablename)).toEqual([...CORE_TABLES].sort())
  })

  it('has the notification columns the sender and the warnings tile need', async () => {
    const { rows } = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'core' and table_name = 'notifications'`,
    )
    const present = new Set(rows.map((r) => r.column_name))
    for (const column of NOTIFICATION_COLUMNS) {
      expect(present.has(column), column).toBe(true)
    }
  })

  it('enables row level security on every table', async () => {
    const { rows } = await client.query<{ relname: string }>(
      `select c.relname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'core' and c.relkind = 'r' and not c.relrowsecurity
       order by c.relname`,
    )
    expect(rows.map((r) => r.relname)).toEqual([])
  })

  it('gives every table a policy for the authenticated role', async () => {
    const { rows } = await client.query<{ tablename: string }>(
      `select t.tablename from pg_tables t
       where t.schemaname = 'core'
         and not exists (
           select 1 from pg_policies p
           where p.schemaname = 'core' and p.tablename = t.tablename
             and 'authenticated' = any(p.roles)
         )
       order by t.tablename`,
    )
    expect(rows.map((r) => r.tablename)).toEqual([])
  })

  it('installs the vector and pgcrypto extensions', async () => {
    const { rows } = await client.query<{ extname: string }>(
      `select extname from pg_extension where extname in ('vector', 'pgcrypto') order by extname`,
    )
    expect(rows.map((r) => r.extname)).toEqual(['pgcrypto', 'vector'])
  })
})

describe('skills.level', () => {
  // level(xp) = least(99, floor(sqrt(xp / 100.0))). core/xp.ts mirrors this and
  // core/xp.test.ts proves the two agree.
  it.each([
    [0, 0],
    [99, 0],
    [100, 1],
    [2500, 5],
    [10_000_000, 99],
  ])('level(%i) is %i', async (xp, expected) => {
    const { rows } = await client.query<{ level: number }>('select skills.level($1) as level', [xp])
    expect(rows[0].level).toBe(expected)
  })

  it('caps at 99 rather than growing without bound', async () => {
    const { rows } = await client.query<{ level: number }>(
      'select skills.level(980100) as at_cap, skills.level(999999999) as past_cap',
    )
    expect(rows[0]).toEqual({ at_cap: 99, past_cap: 99 })
  })
})

describe('grants', () => {
  it('denies the anon role any read of core.settings', async () => {
    await client.query('begin')
    try {
      await client.query('set local role anon')
      await expect(client.query('select * from core.settings')).rejects.toThrow(/permission denied/i)
    } finally {
      await client.query('rollback')
    }
  })

  it('creates pos_readonly as a role that cannot log in', async () => {
    const { rows } = await client.query<{ rolcanlogin: boolean }>(
      `select rolcanlogin from pg_roles where rolname = 'pos_readonly'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].rolcanlogin).toBe(false)
  })

  it('lets pos_readonly read core but never write it', async () => {
    await client.query('begin')
    try {
      await client.query('set local role pos_readonly')
      await expect(client.query('select * from core.settings')).resolves.toBeDefined()
      await expect(
        client.query(`insert into core.settings (key, value) values ('nope', '1'::jsonb)`),
      ).rejects.toThrow(/permission denied/i)
    } finally {
      await client.query('rollback')
    }
  })
})

describe('updated_at trigger', () => {
  it('advances updated_at on update but leaves created_at alone', async () => {
    await client.query('begin')
    try {
      await client.query(
        `insert into core.settings (key, value) values ('__trigger_test', '1'::jsonb)`,
      )
      // Compared in Postgres, not in JavaScript. The trigger uses
      // clock_timestamp(), which has microsecond precision, and a Date's
      // getTime() is milliseconds: two fast statements share a millisecond
      // often enough that the JS comparison was flaky rather than wrong.
      const result = await client.query<{ advanced: boolean; created_held: boolean }>(
        `update core.settings set value = '2'::jsonb where key = '__trigger_test'
         returning updated_at > created_at as advanced,
                   created_at = (select created_at from core.settings
                                  where key = '__trigger_test') as created_held`,
      )
      expect(result.rows[0].advanced).toBe(true)
      expect(result.rows[0].created_held).toBe(true)
    } finally {
      await client.query('rollback')
    }
  })
})

describe('indexes', () => {
  it('indexes embeddings for vector search with HNSW and for text with GIN', async () => {
    const { rows } = await client.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = 'core' and tablename = 'embeddings'`,
    )
    const defs = rows.map((r) => r.indexdef).join('\n')
    expect(defs).toMatch(/using hnsw/i)
    expect(defs).toMatch(/using gin/i)
  })
})
