import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { latestRun, pruneClientErrors, pruneRequestLog, pruneStaleJobs, runJob, runLine } from './jobs'
import { pending, queue, renderEmail, snoozeNotification, unreadWarnings } from './notify'
import { buildSummary } from './orchestrator'

beforeEach(async () => {
  await db().query('delete from core.jobs')
  await db().query('delete from core.job_runs')
  await db().query('delete from core.notifications')
  await db().query('delete from core.proposals')
  await db().query('delete from core.llm_calls')
  await db().query('delete from core.digests')
  await db().query('delete from core.request_log')
  await db().query('delete from core.settings')

  // Quiet hours default to 22:00, and these tests are about what is queued, not
  // about the delivery window. Without this they pass or fail on the clock.
  // From and to being equal is an empty window, so nothing is held back.
  await db().query(
    `insert into core.settings (key, value)
     values ('quiet_from', '"00:00"'), ('quiet_to', '"00:00"')`,
  )
})

describe('runJob', () => {
  it('records a job that succeeded', async () => {
    const result = await runJob('notes', 'nightly_digest', async () => ({ total: 5 }))

    expect(result.status).toBe('ok')
    const { rows } = await db().query<{ last_status: string }>(
      `select last_status from core.jobs where module = 'notes' and name = 'nightly_digest'`,
    )
    expect(rows).toMatchObject([{ last_status: 'ok' }])
  })

  it('records a job that threw as failed rather than propagating', async () => {
    const result = await runJob('finance', 'sync', async () => {
      throw new Error('auth_expired: refresh token rejected')
    })

    expect(result.status).toBe('failed')
    expect(result.detail).toMatch(/auth_expired/)

    const { rows } = await db().query<{ last_status: string; log: { error: string } }>(
      `select last_status, log from core.jobs where module = 'finance' and name = 'sync'`,
    )
    expect(rows[0].last_status).toBe('failed')
    // The error text is kept, because it is what the Retry card shows.
    expect(rows[0].log.error).toMatch(/auth_expired/)
  })

  it('runs the next job after one fails', async () => {
    const order: string[] = []

    await runJob('a', 'one', async () => {
      order.push('one')
      throw new Error('boom')
    })
    await runJob('a', 'two', async () => {
      order.push('two')
    })

    // A bank sync that cannot reach its provider must not cost you the digest.
    expect(order).toEqual(['one', 'two'])
  })
})

describe('latestRun', () => {
  it('reads the last finished run, not the standing state of every job', async () => {
    // A job that failed once and never ran again: a renamed job, or a module
    // since removed. core.jobs keeps it as failed forever; the run does not.
    await runJob('gone', 'nightly_digest', async () => {
      throw new Error('relation "gone.thing" does not exist')
    })
    await db().query(
      `insert into core.job_runs (status, started_at, log)
       values ('partial', now() - interval '2 days', $1::jsonb),
              ('clean', now() - interval '1 day', $2::jsonb),
              ('running', now(), '{}'::jsonb)`,
      [
        JSON.stringify({ jobs: [{ module: 'gone', name: 'nightly_digest', status: 'failed' }] }),
        JSON.stringify({
          jobs: [
            { module: 'finance', name: 'sync', status: 'ok' },
            { module: 'core', name: 'digests', status: 'ok' },
          ],
        }),
      ],
    )

    expect(await latestRun()).toMatchObject({ status: 'clean', failed: 0, total: 2 })
  })

  it('is null before anything has run', async () => {
    expect(await latestRun()).toBeNull()
  })
})

describe('runLine', () => {
  it('says how the run went in one clause', () => {
    expect(runLine({ status: 'clean', failed: 0, total: 14 })).toBe('all 14 jobs ok')
    expect(runLine({ status: 'partial', failed: 2, total: 14 })).toBe('partial, 2 of 14 jobs failed')
    expect(runLine({ status: 'failed', failed: 14, total: 14 })).toBe('failed, every job')
  })
})

describe('pruneStaleJobs', () => {
  it('drops rows for jobs nothing registers and keeps the rest', async () => {
    // Production, 2026-09-15: the notes module was deleted and its migration
    // cleared core.jobs, but a Run now on the still-deployed old build ran the
    // notes job against the dropped schema and upserted the row back as
    // failed. Nothing ran it again, so every nightly from then on raised
    // "notes.nightly_digest failed" (six digests, 09-16 to 09-20).
    await runJob('notes', 'nightly_digest', async () => {
      throw new Error('relation "notes.note" does not exist')
    })
    await runJob('core', 'digests', async () => ({}))
    await runJob('finance', 'nightly_digest', async () => ({}))

    const { deleted } = await pruneStaleJobs()

    expect(deleted).toBe(1)
    const { rows } = await db().query<{ module: string }>(`select module from core.jobs order by module`)
    expect(rows.map((r) => r.module)).toEqual(['core', 'finance'])
  })
})

describe('pruneRequestLog', () => {
  it('deletes rows older than ninety days and keeps the rest', async () => {
    await db().query(
      `insert into core.request_log (route, method, status, duration_ms, occurred_at)
       values ('/api/old', 'GET', 200, 1, now() - interval '100 days'),
              ('/api/new', 'GET', 200, 1, now())`,
    )

    const { deleted } = await pruneRequestLog()
    expect(deleted).toBe(1)

    const { rows } = await db().query<{ route: string }>('select route from core.request_log')
    expect(rows).toMatchObject([{ route: '/api/new' }])
  })
})

describe('pruneClientErrors', () => {
  it('deletes rows older than thirty days and keeps the rest', async () => {
    await db().query(
      `insert into core.client_errors (route, message, occurred_at)
       values ('/old', 'stale', now() - interval '31 days'),
              ('/new', 'fresh', now())`,
    )

    const { deleted } = await pruneClientErrors()
    expect(deleted).toBe(1)

    const { rows } = await db().query<{ route: string }>('select route from core.client_errors')
    expect(rows).toMatchObject([{ route: '/new' }])
  })
})

describe('notifications', () => {
  it('holds a notification until it is due', async () => {
    await queue({ title: 'Later', body: '', dueAt: new Date(Date.now() + 86_400_000) })
    expect(await pending()).toHaveLength(0)
  })

  it('puts urgent items first', async () => {
    await queue({ title: 'Ordinary', body: '' })
    await queue({ title: 'Urgent one', body: '', urgency: 'urgent' })

    const items = await pending()
    expect(items[0].title).toBe('Urgent one')
  })

  it('renders every alert into one email, with the rest counted', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      title: `Alert ${i}`,
      body: 'detail',
      urgency: 'normal',
      channel: 'email',
    }))

    const body = renderEmail('Two things need you.', items, 482)

    // One email a day, never a flood: the top three, then a count.
    expect(body).toContain('Two things need you.')
    expect(body).toContain('Alert 0')
    expect(body).toContain('Alert 2')
    expect(body).not.toContain('Alert 3')
    expect(body).toContain('and 2 more.')
    expect(body).toContain('$4.82')
  })

  it('says so plainly when there is nothing', () => {
    expect(renderEmail(null, [], 0)).toContain('Nothing needs you today.')
  })
})

describe('buildSummary', () => {
  it('is empty and calm when nothing is wrong', async () => {
    const summary = await buildSummary()
    expect(summary.alerts).toEqual([])
    expect(summary.failedJobs).toEqual([])
  })

  it('raises a failed job as an alert', async () => {
    await runJob('finance', 'sync', async () => {
      throw new Error('nope')
    })

    const summary = await buildSummary()
    expect(summary.failedJobs).toMatchObject([{ module: 'finance', name: 'sync' }])
    expect(summary.alerts[0]).toMatchObject({ tone: 'bad' })
    expect(summary.alerts[0].title).toContain('finance.sync')
  })

  it('raises waiting proposals', async () => {
    await db().query(
      `insert into core.proposals (module, tool, agent, reason)
       values ('notes', 'write', 'orchestrator', 'because')`,
    )

    const summary = await buildSummary()
    expect(summary.pendingProposals).toBe(1)
    expect(summary.alerts.some((a) => a.title.includes('proposal'))).toBe(true)
  })

  it('raises spend past the cap', async () => {
    await db().query(
      `insert into core.settings (key, value) values ('llm_soft_cap_cents', '10'::jsonb)`,
    )
    await db().query(
      `insert into core.llm_calls (model, purpose, cost_cents) values ('claude-haiku-4-5', 'research', 50)`,
    )

    const summary = await buildSummary()
    expect(summary.spendCents).toBe(50)
    expect(summary.alerts.some((a) => a.title.includes('past the cap'))).toBe(true)
  })

  it('carries each module digest through without understanding it', async () => {
    await db().query(
      `insert into core.digests (module, payload) values ('notes', '{"total": 5}'::jsonb)`,
    )

    const summary = await buildSummary()
    // The orchestrator reads digests and never a module's own tables.
    expect(summary.modules).toMatchObject([{ module: 'notes', payload: { total: 5 } }])
  })
})

describe('assembleSummary', () => {
  // Decided 2026-09-14: the email goes out every night. A quiet night says so
  // rather than saying nothing, because silence and a broken cron look the
  // same from the inbox.
  it('queues one digest on a night with nothing wrong', async () => {
    const { assembleSummary } = await import('./orchestrator')
    const result = await assembleSummary()

    expect(result.queued).toBe(true)
    const items = await pending()
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Nothing needs you today')
    expect(items[0].urgency).toBe('normal')
  })

  it('queues exactly one notification however many alerts there are', async () => {
    await runJob('a', 'one', async () => {
      throw new Error('boom')
    })
    await runJob('b', 'two', async () => {
      throw new Error('boom')
    })
    await db().query(
      `insert into core.proposals (module, tool, agent, reason)
       values ('notes', 'write', 'orchestrator', 'because')`,
    )

    const { assembleSummary } = await import('./orchestrator')
    const result = await assembleSummary()

    expect(result.queued).toBe(true)
    // Three alerts, one notification: the sender bundles, and the unread count
    // should grow by nights rather than by however much went wrong.
    const items = await pending()
    expect(items).toHaveLength(1)
    expect(items[0].urgency).toBe('urgent')
    expect(items[0].body).toContain('a.one failed')
    expect(items[0].body).toContain('b.two failed')
  })
})

describe('snoozeNotification', () => {
  it('hides the row from the dashboard and the sender until the day comes', async () => {
    await queue({ title: 'Statement due', body: '' })
    const [{ id }] = await unreadWarnings()

    await snoozeNotification(id, 1)
    // Snoozed is neither read nor sent: it comes back tomorrow, on both paths.
    expect(await unreadWarnings()).toHaveLength(0)
    expect(await pending()).toHaveLength(0)

    await snoozeNotification(id, 0)
    expect(await unreadWarnings()).toHaveLength(1)
  })
})

describe('sendPending', () => {
  it('skips quietly when nothing is waiting', async () => {
    const { sendPending } = await import('./notify')
    expect(await sendPending()).toMatchObject({ sent: 0, emails: 0 })
  })

  it('skips rather than failing when OWNER_EMAIL is unset', async () => {
    await queue({ title: 'Something', body: '' })

    const original = process.env.OWNER_EMAIL
    delete process.env.OWNER_EMAIL
    // Sending is off in a test by default, and that skip comes first. This one
    // is about the address being missing, so it has to get past the first gate
    // to reach the gate it is testing.
    process.env.EMAIL_SEND = '1'
    try {
      const { sendPending } = await import('./notify')
      const result = await sendPending()
      // Nothing is wrong yet: the rows wait for configuration rather than being
      // marked sent and lost.
      expect(result).toMatchObject({ sent: 0, emails: 0 })
      expect(result.skipped).toMatch(/OWNER_EMAIL/)
      expect(await pending()).toHaveLength(1)
    } finally {
      delete process.env.EMAIL_SEND
      if (original) process.env.OWNER_EMAIL = original
    }
  })

  it('refuses to send outside production, and leaves the rows queued', async () => {
    await queue({ title: 'Northwind Rewards card due in 3 days', body: '$1,374 statement' })

    // No VERCEL_ENV and no EMAIL_SEND, which is a local run and an e2e pass
    // alike. The e2e suite presses Run now, that used to be a real digest, and
    // the fixture above is the copy that reached the owner's inbox.
    const { sendPending } = await import('./notify')
    const result = await sendPending()

    expect(result).toMatchObject({ sent: 0, emails: 0 })
    expect(result.skipped).toMatch(/off outside production/)
    // Queued, not marked sent: production still owes this one.
    expect(await pending()).toHaveLength(1)
  })

  it('lets production through to the address check', async () => {
    await queue({ title: 'Something', body: '' })

    const original = process.env.VERCEL_ENV
    process.env.VERCEL_ENV = 'production'
    const email = process.env.OWNER_EMAIL
    delete process.env.OWNER_EMAIL
    try {
      const { sendPending } = await import('./notify')
      // Past the sending gate, stopped by the missing address rather than by it.
      expect((await sendPending()).skipped).toMatch(/OWNER_EMAIL/)
    } finally {
      if (original) process.env.VERCEL_ENV = original
      else delete process.env.VERCEL_ENV
      if (email) process.env.OWNER_EMAIL = email
    }
  })
})

describe('sendingAllowed', () => {
  it('is production, or an explicit ask, and nothing else', async () => {
    const { sendingAllowed } = await import('@/integrations/resend/client')
    const vercel = process.env.VERCEL_ENV
    const send = process.env.EMAIL_SEND

    try {
      delete process.env.VERCEL_ENV
      delete process.env.EMAIL_SEND
      expect(sendingAllowed()).toBe(false)

      // A preview deployment carries the same DATABASE_URL shape as production
      // and must not mail anyone.
      process.env.VERCEL_ENV = 'preview'
      expect(sendingAllowed()).toBe(false)

      process.env.VERCEL_ENV = 'production'
      expect(sendingAllowed()).toBe(true)

      delete process.env.VERCEL_ENV
      process.env.EMAIL_SEND = '1'
      expect(sendingAllowed()).toBe(true)
    } finally {
      if (vercel) process.env.VERCEL_ENV = vercel
      else delete process.env.VERCEL_ENV
      if (send) process.env.EMAIL_SEND = send
      else delete process.env.EMAIL_SEND
    }
  })
})

describe('digest notifications do not stack', () => {
  it('supersedes an unread digest rather than queueing beside it', async () => {
    await db().query(
      `insert into core.proposals (module, tool, agent, reason)
       values ('notes', 'write', 'orchestrator', 'because')`,
    )
    const { assembleSummary } = await import('./orchestrator')

    await assembleSummary()
    await assembleSummary()
    await assembleSummary()

    // Three runs, one waiting digest: pressing Run now repeatedly must not bury
    // the dashboard in near-identical warnings.
    expect(await pending()).toHaveLength(1)
  })

  it('leaves a module alert alone', async () => {
    await queue({ title: 'Bill due Thursday', body: '' })
    await db().query(
      `insert into core.proposals (module, tool, agent, reason)
       values ('notes', 'write', 'orchestrator', 'because')`,
    )

    const { assembleSummary } = await import('./orchestrator')
    await assembleSummary()

    const titles = (await pending()).map((p) => p.title)
    expect(titles).toContain('Bill due Thursday')
    expect(titles).toHaveLength(2)
  })

  it('keeps a digest that already went out, because that is history', async () => {
    await db().query(
      `insert into core.notifications (channel, title, body, sent_at)
       values ('digest', 'Last night', '', now())`,
    )
    await db().query(
      `insert into core.proposals (module, tool, agent, reason)
       values ('notes', 'write', 'orchestrator', 'because')`,
    )

    const { assembleSummary } = await import('./orchestrator')
    await assembleSummary()

    const { rows } = await db().query<{ n: string }>(
      `select count(*)::text as n from core.notifications where channel = 'digest'`,
    )
    expect(Number(rows[0].n)).toBe(2)
  })
})
