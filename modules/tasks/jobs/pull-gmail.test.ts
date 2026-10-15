import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GmailMessage } from '@/integrations/google/client'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const complete = vi.fn()
vi.mock('@/core/llm', async () => {
  const actual = await vi.importActual<typeof import('@/core/llm')>('@/core/llm')
  return { ...actual, complete: (...args: unknown[]) => complete(...args) }
})

const { db } = await import('@/core/db')
const { saveCredentials } = await import('@/core/credentials')
const { SoftCapExceeded } = await import('@/core/llm')
const { pullGmail } = await import('./pull-gmail')
const { approve } = await import('@/core/proposals')

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url')
const ICS = readFileSync(new URL('../../../e2e/fixtures/gmail-invite.ics', import.meta.url), 'utf8').replaceAll(
  '{{DAY}}',
  '20261010',
)

const mail = (id: string, subject: string, attach = false): GmailMessage => ({
  id,
  payload: {
    mimeType: 'multipart/mixed',
    headers: [{ name: 'Subject', value: subject }],
    parts: [
      { mimeType: 'text/plain', body: { data: b64('Please pay by the 15th.') } },
      ...(attach ? [{ mimeType: 'application/ics', filename: 'invite.ics', body: { attachmentId: 'att1' } }] : []),
    ],
  },
})

// The pull against a stubbed Gmail: an invite is proposed by rules, anything
// else goes to the model, and a message proposed once is never fetched again.
describe('pullGmail', () => {
  const now = new Date('2026-10-01T12:00:00Z')
  let served: GmailMessage[]
  let fetched: string[]

  beforeEach(async () => {
    await saveCredentials('google', { access_token: 'token', refresh_token: 'refresh' }, { expiresAt: new Date(Date.now() + 3_600_000) })
    served = []
    fetched = []
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = new URL(String(input))
      fetched.push(url.pathname)
      if (url.pathname.endsWith('/messages')) {
        expect(url.searchParams.get('q')).toBe('label:POS newer_than:30d')
        return Response.json({ messages: served.map((m) => ({ id: m.id })) })
      }
      if (url.pathname.includes('/attachments/')) return Response.json({ data: b64(ICS) })
      const id = url.pathname.split('/messages/')[1]
      return Response.json(served.find((m) => m.id === id))
    })
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    complete.mockReset()
    await db().query(`delete from core.proposals where agent = 'gmail'`)
    await db().query(`delete from core.connections`)
  })

  afterAll(async () => {
    await db().end()
  })

  it('says it skipped when Google is not connected', async () => {
    await db().query(`delete from core.connections`)
    await expect(pullGmail(now)).resolves.toMatchObject({ skipped: true, proposals: 0 })
  })

  it('proposes an invite as an event without the model, then skips it on the next run', async () => {
    served = [mail('m1', 'Your reservation at Juniper Table', true)]
    await expect(pullGmail(now)).resolves.toMatchObject({ skipped: false, messages: 1, proposals: 1 })
    expect(complete).not.toHaveBeenCalled()

    const { rows } = await db().query(`select tool, payload, status from core.proposals where agent = 'gmail'`)
    expect(rows).toMatchObject([{ tool: 'write_event', status: 'pending', payload: { title: 'Dinner at Juniper Table', starts: '19:00' } }])

    fetched = []
    await expect(pullGmail(now)).resolves.toMatchObject({ messages: 0, proposals: 0 })
    expect(fetched.filter((p) => p.includes('/messages/'))).toEqual([])
  })

  it('puts an invite on a day of a trip in that trip\'s inbox, not on Review, and skips it next run', async () => {
    const { rows: made } = await db().query<{ id: string }>(
      `insert into travel.trip (name, starts_on, ends_on, status)
       values ('Gmail trip test', '2026-10-08', '2026-10-12', 'booked') returning id`,
    )
    try {
      served = [mail('m9', 'Your reservation at Juniper Table', true)]
      await expect(pullGmail(now)).resolves.toMatchObject({ proposals: 0, items: 1 })
      const { rows } = await db().query(
        `select title, status, occurs_at::text from travel.itinerary_item where trip_id = $1`,
        [made[0].id],
      )
      expect(rows).toEqual([{ title: 'Dinner at Juniper Table', status: 'pending', occurs_at: '19:00:00' }])
      expect((await db().query(`select 1 from core.proposals where agent = 'gmail'`)).rows).toHaveLength(0)

      fetched = []
      await expect(pullGmail(now)).resolves.toMatchObject({ messages: 0, items: 0 })
      expect(fetched.filter((p) => p.includes('/messages/'))).toEqual([])
    } finally {
      await db().query(`delete from travel.trip where id = $1`, [made[0].id])
    }
  })

  it('asks the model about a message with no invite', async () => {
    served = [mail('m2', 'Statement ready')]
    complete.mockResolvedValue(
      JSON.stringify({ kind: 'task', title: 'Pay Comcast', date: '2026-10-15', time: null, amount: '$84', place: null, confidence: 0.8 }),
    )
    await expect(pullGmail(now)).resolves.toMatchObject({ proposals: 1 })
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'mail', model: 'claude-haiku-4-5' }))
    const { rows } = await db().query(`select payload, confidence::float as confidence from core.proposals where agent = 'gmail'`)
    expect(rows[0]).toMatchObject({ confidence: 0.8, payload: { title: 'Pay Comcast', due_on: '2026-10-15', classified_by: 'model' } })
  })

  it('still proposes from the subject when the month is over the cap', async () => {
    served = [mail('m3', 'Invoice 42')]
    complete.mockRejectedValue(new SoftCapExceeded(1200, 1000))
    await expect(pullGmail(now)).resolves.toMatchObject({ proposals: 1 })
    const { rows } = await db().query(`select payload from core.proposals where agent = 'gmail'`)
    expect(rows[0].payload).toMatchObject({ title: 'Invoice 42', classified_by: 'rules' })
  })

  it('never sends an invite to the model, even one with nothing to put on the calendar', async () => {
    served = [mail('m4', 'Cancelled: dinner', true)]
    const cancelled = ICS.replace('DTSTAMP:', 'STATUS:CANCELLED\r\nDTSTAMP:')
    const stubbed = globalThis.fetch
    vi.stubGlobal('fetch', async (input: string | URL) =>
      String(input).includes('/attachments/') ? Response.json({ data: b64(cancelled) }) : stubbed(input),
    )
    await expect(pullGmail(now)).resolves.toMatchObject({ proposals: 1 })
    expect(complete).not.toHaveBeenCalled()
    const { rows } = await db().query(`select payload from core.proposals where agent = 'gmail'`)
    expect(rows[0].payload).toMatchObject({ title: 'Cancelled: dinner', classified_by: 'rules' })
  })

  it('an approved task proposal is a task in review, from the agent', async () => {
    served = [mail('m5', 'Invoice 42')]
    complete.mockResolvedValue(
      JSON.stringify({ kind: 'task', title: 'Pay invoice 42', date: '2026-10-15', time: null, amount: null, place: null, confidence: 0.9 }),
    )
    await pullGmail(now)
    const { rows } = await db().query<{ id: string }>(`select id from core.proposals where agent = 'gmail'`)
    await approve(rows[0].id)
    const task = await db().query(`select status, source, notes from tasks.task where title = 'Pay invoice 42'`)
    expect(task.rows[0]).toMatchObject({ status: 'review', source: 'agent' })
    expect(task.rows[0].notes).toContain('https://mail.google.com/mail/u/0/#all/m5')
    await db().query(`delete from tasks.task where title = 'Pay invoice 42'`)
  })

  it('skips with the step to take when the grant predates Gmail or the API is off', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: { code: 403, message: 'Request had insufficient authentication scopes.' } }, { status: 403 }),
    )
    await expect(pullGmail(now)).resolves.toMatchObject({
      skipped: true,
      detail: 'Google has not granted Gmail. Reconnect Google to add it.',
    })
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: { code: 403, message: 'Gmail API has not been used in project 123 before or it is disabled.' } }, { status: 403 }),
    )
    await expect(pullGmail(now)).resolves.toMatchObject({ skipped: true, detail: expect.stringMatching(/^The Gmail API is not enabled/) })
  })

  it('fails on any other Google error', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: { code: 500, message: 'Backend Error' } }, { status: 500 }))
    await expect(pullGmail(now)).rejects.toThrow('Google 500: Backend Error')
  })
})
