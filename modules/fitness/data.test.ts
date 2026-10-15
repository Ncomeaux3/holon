import { afterAll, beforeEach, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const { db } = await import('@/core/db')
const { arrivals } = await import('./data')
const { appleAlert } = await import('./jobs/nightly-digest')

const HAE = '/api/integrations/health_auto_export/webhook'
const TITLE = 'Apple Health is not getting through'

async function hit(status: number, ago: string) {
  await db().query(
    `insert into core.request_log (route, method, status, duration_ms, occurred_at)
     values ($1, 'POST', $2, 1, now() - $3::interval)`,
    [HAE, status, ago],
  )
}

async function alerts() {
  const { rows } = await db().query(`select 1 from core.notifications where title = $1`, [TITLE])
  return rows.length
}

// Before, not after: other files (integration-routes.test.ts) leave posts on
// these routes, and a later 200 would hide the rejected ones.
async function clean() {
  await db().query(
    `delete from core.request_log where route in ($1, '/api/integrations/apple_shortcuts/webhook')`,
    [HAE],
  )
  await db().query(`delete from core.notifications where title = $1`, [TITLE])
  await db().query(`delete from fitness.body_metric where source = 'health_auto_export'`)
}
beforeEach(clean)
afterAll(async () => {
  await clean()
  await db().end()
})

it('counts the rejected posts after the last accepted one', async () => {
  await hit(401, '3 hours')
  await hit(200, '2 hours')
  await hit(401, '1 hour')
  await hit(400, '30 minutes')
  // A server error is not the phone's fault.
  await hit(500, '20 minutes')
  const a = await arrivals()
  expect(a.rejected).toBe(2)
  expect(a.lastAccepted).not.toBeNull()
})

it('counts the last 7 days when nothing was ever accepted', async () => {
  await hit(401, '8 days')
  await hit(401, '2 days')
  const a = await arrivals()
  expect(a).toMatchObject({ rejected: 1, lastAccepted: null })
})

it('reads when readings last arrived from the rows themselves', async () => {
  await db().query(
    `insert into fitness.body_metric (kind, measured_on, value, source)
     values ('weight', core.today(), 80, 'health_auto_export')`,
  )
  const a = await arrivals()
  expect(a.readings).not.toBeNull()
})

it('raises one alert when posts were rejected, none when all is well', async () => {
  await hit(200, '1 hour')
  await appleAlert()
  expect(await alerts()).toBe(0)
  await hit(401, '10 minutes')
  await appleAlert()
  expect(await alerts()).toBe(1)
  // Run now runs the job again; the unsent alert stands for both.
  await appleAlert()
  expect(await alerts()).toBe(1)
})
