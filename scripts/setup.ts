import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { parse } from 'yaml'
import { db } from '@/core/db'
import { DEFAULT_SETTINGS, type SettingKey } from '@/core/settings'

// Fork and fill bootstrap. Everything here is idempotent: running it twice is a
// no-op, because the most likely time to run it is after something went wrong.
//
//   pnpm setup           schema, settings, xp weights, owner user
//   pnpm setup --demo    also every module's seed.ts

const ROOT = path.join(import.meta.dirname, '..')

type Step = { label: string; detail: string }
const done: Step[] = []

function say(label: string, detail: string) {
  done.push({ label, detail })
  console.log(`  ${label.padEnd(22)} ${detail}`)
}

/**
 * Every key .env.example names has to be present. A missing one fails here with
 * the key name rather than three steps later with a stack trace.
 */
function checkEnv(): void {
  const example = readFileSync(path.join(ROOT, '.env.example'), 'utf8')
  const keys = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1])

  // Blank is as good as missing for anything the app actually reads. The OAuth
  // client pairs are the exception: each is needed only once its provider is
  // connected, and the Connect button says so when it is missing.
  const optional = new Set([
    'STRAVA_CLIENT_ID',
    'STRAVA_CLIENT_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'RESEND_FROM',
  ])
  const missing = keys.filter((k) => !optional.has(k) && !process.env[k])

  if (missing.length > 0) {
    throw new Error(
      `Missing in .env: ${missing.join(', ')}.\nCopy .env.example to .env and fill these in.`,
    )
  }
  say('env', `${keys.length} keys present`)
}

function applyMigrations(): void {
  // `migration up --local` reaches the local stack whatever DATABASE_URL says,
  // so a bootstrap against production (--env-file=.env.production) must not
  // run it: the hosted schema is pushed with `supabase db push`, by hand.
  if (!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? '')) {
    say('migrations', 'remote database, left to supabase db push')
    return
  }
  // migration up, never db reset: reset rebuilds the database and takes every
  // provider key in core.connections with it.
  const out = execFileSync('supabase', ['migration', 'up', '--local'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  const applied = [...out.matchAll(/Applying migration (\S+)/g)].map((m) => m[1])
  say('migrations', applied.length > 0 ? `applied ${applied.length}` : 'already up to date')
}

async function seedSettings(): Promise<void> {
  // Defaults only: an existing value is the owner's and is never overwritten.
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db().query(
      `insert into core.settings (key, value) values ($1, $2::jsonb)
       on conflict (key) do nothing`,
      [key as SettingKey, JSON.stringify(value)],
    )
  }
  say('settings', `${Object.keys(DEFAULT_SETTINGS).length} defaults`)
}

async function seedXpWeights(): Promise<void> {
  const file = readFileSync(path.join(ROOT, 'modules', 'skills', 'xp.yaml'), 'utf8')
  const { weights } = parse(file) as { weights: Record<string, number> }

  for (const [eventType, weight] of Object.entries(weights)) {
    await db().query(
      `insert into skills.xp_weight (event_type, weight) values ($1, $2)
       on conflict (event_type) do update set weight = excluded.weight`,
      [eventType, weight],
    )
  }
  say('xp weights', `${Object.keys(weights).length} event types`)
}

/**
 * One owner, created from OWNER_EMAIL. Signups are disabled, so this is the
 * only way a user exists at all.
 */
async function createOwner(): Promise<void> {
  const email = process.env.OWNER_EMAIL!
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true })
  if (error) {
    // Already there is the expected outcome on a second run.
    if (/already|exists|registered/i.test(error.message)) return say('owner', `${email} exists`)
    throw error
  }
  say('owner', `created ${data.user?.email}`)
}

/**
 * Every module's seed.ts. Found by looking rather than by a registry entry,
 * because a seed is a development convenience and not part of the contract.
 */
async function seedModules(): Promise<void> {
  const dir = path.join(ROOT, 'modules')
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()

  for (const name of names) {
    // A file URL, not the @/ alias: the alias cannot resolve a computed import
    // specifier, and a try/catch around it would hide a broken seed as a
    // missing one. Absence is checked, failure is allowed to throw.
    const file = path.join(dir, name, 'seed.ts')
    if (!existsSync(file)) continue

    const { seed } = (await import(pathToFileURL(file).href)) as {
      seed?: () => Promise<number>
    }
    if (!seed) throw new Error(`modules/${name}/seed.ts exports no seed()`)

    // Seeds upsert on external_id, so this is safe to run repeatedly.
    say(`seed ${name}`, `${await seed()} rows`)
  }
}

async function main(): Promise<void> {
  const demo = process.argv.includes('--demo')
  console.log(`\nPOS setup${demo ? ' --demo' : ''}\n`)

  checkEnv()
  applyMigrations()
  await seedSettings()
  await seedXpWeights()
  await createOwner()
  if (demo) await seedModules()

  console.log(`\n${done.length} steps done.\n`)
  console.log('Next:')
  console.log('  pnpm dev                     then sign in at /login')
  console.log('  /settings/connections        paste the Anthropic, Voyage and Resend keys')
  console.log('  Run now on the dashboard     first nightly run and first email\n')

  await db().end()
}

main().catch((error) => {
  console.error(`\nSetup failed: ${error instanceof Error ? error.message : error}\n`)
  process.exit(1)
})
