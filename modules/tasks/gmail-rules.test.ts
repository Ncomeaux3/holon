import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { GmailMessage } from '@/integrations/google/client'
import { bodyText, fromExtract, gmailLink, kindFromSubject, parseExtract, proposalsFromIcs, rulesOnly, tripItem } from './gmail-rules'

const ZONE = 'America/Chicago'
const NOW = new Date('2026-10-01T12:00:00Z')
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url')
const ICS = readFileSync(new URL('../../e2e/fixtures/gmail-invite.ics', import.meta.url), 'utf8').replaceAll(
  '{{DAY}}',
  '20261010',
)

function message(subject: string, parts: GmailMessage['payload']['parts']): GmailMessage {
  return {
    id: 'msg1',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'Subject', value: subject },
        { name: 'From', value: 'Juniper Table <reservations@example.com>' },
      ],
      parts,
    },
  }
}

const plain = (text: string) => ({ mimeType: 'text/plain', body: { data: b64(text) } })

describe('proposalsFromIcs', () => {
  it('turns an attached invite into an event proposal on the owner\'s wall clock, with no model', () => {
    const msg = message('Your reservation at Juniper Table', [
      plain('See you soon.'),
      { mimeType: 'application/ics', filename: 'invite.ics', body: { data: b64(ICS) } },
    ])
    const [proposal, ...rest] = proposalsFromIcs(msg, ZONE, NOW)
    expect(rest).toHaveLength(0)
    expect(proposal).toMatchObject({
      module: 'calendar',
      tool: 'write_event',
      agent: 'gmail',
      evidence: gmailLink('msg1'),
      confidence: 1,
      payload: {
        title: 'Dinner at Juniper Table',
        on_date: '2026-10-10',
        all_day: false,
        starts: '19:00',
        ends: '20:30',
        location: '418 Example Ave, Portland',
        classified_by: 'rules',
      },
    })
  })

  it('reads an inline text/calendar part the same way, and nothing from a message without one', () => {
    expect(proposalsFromIcs(message('Invite', [{ mimeType: 'text/calendar', body: { data: b64(ICS) } }]), ZONE, NOW)).toHaveLength(1)
    expect(proposalsFromIcs(message('Hello', [plain('No invite here.')]), ZONE, NOW)).toEqual([])
  })
})

describe('proposalsFromIcs, repeating and cancelled invites', () => {
  const weekly = ICS.replace('DTSTAMP:', 'RRULE:FREQ=WEEKLY\r\nDTSTAMP:').replaceAll('20261010', '20260901')

  it('proposes a weekly invite once, at its next occurrence, not every week in the window', () => {
    const proposals = proposalsFromIcs(message('Standing dinner', [{ mimeType: 'text/calendar', body: { data: b64(weekly) } }]), ZONE, NOW)
    expect(proposals).toHaveLength(1)
    // 2026-09-01 is a Tuesday; the first Tuesday on or after 2026-10-01 is the 6th.
    expect(proposals[0].payload).toMatchObject({ on_date: '2026-10-06', starts: '19:00' })
  })

  it('proposes nothing from a cancellation', () => {
    const cancelled = ICS.replace('DTSTAMP:', 'STATUS:CANCELLED\r\nDTSTAMP:')
    expect(proposalsFromIcs(message('Cancelled: dinner', [{ mimeType: 'text/calendar', body: { data: b64(cancelled) } }]), ZONE, NOW)).toEqual([])
  })
})

describe('bodyText', () => {
  it('decodes a base64url plain part, and strips tags when only HTML came', () => {
    expect(bodyText(message('x', [plain('Amount due: $84.20 ~ by Friday')]))).toBe('Amount due: $84.20 ~ by Friday')
    const html = { mimeType: 'text/html', body: { data: b64('<style>p{}</style><p>Total&nbsp;<b>$12</b></p>') } }
    expect(bodyText(message('x', [html]))).toBe('Total $12')
  })
})

describe('kindFromSubject', () => {
  it('reads reservations and confirmations as events, invoices and dues as tasks', () => {
    expect(kindFromSubject('Your reservation is confirmed')).toBe('event')
    expect(kindFromSubject('Booking confirmation #123')).toBe('event')
    expect(kindFromSubject('Invoice INV-42 from Acme')).toBe('task')
    expect(kindFromSubject('Your water bill is due')).toBe('task')
    expect(kindFromSubject('Lunch next week?')).toBeNull()
  })
})

describe('parseExtract and fromExtract', () => {
  const reply = (over: object) =>
    JSON.stringify({ kind: 'task', title: 'Pay Comcast bill', date: '2026-10-15', time: null, amount: '$84.20', place: null, confidence: 0.9, ...over })

  it('accepts a reply wrapped in prose or fences and refuses one off the shape', () => {
    expect(parseExtract('```json\n' + reply({}) + '\n```')?.title).toBe('Pay Comcast bill')
    expect(parseExtract(reply({ date: 'next Tuesday' }))).toBeNull()
    expect(parseExtract('I cannot help with that.')).toBeNull()
  })

  it('makes a task carrying the amount and the email link in its notes', () => {
    const p = fromExtract(message('Comcast statement', [plain('...')]), parseExtract(reply({}))!)
    expect(p).toMatchObject({
      module: 'tasks',
      tool: 'write',
      confidence: 0.9,
      payload: { title: 'Pay Comcast bill', due_on: '2026-10-15', classified_by: 'model' },
    })
    expect(p.payload.notes).toBe(`Amount: $84.20\nEmail: ${gmailLink('msg1')}`)
  })

  it('makes a dated event, and a task when the event has no date', () => {
    const msg = message('Table for two', [plain('...')])
    expect(fromExtract(msg, parseExtract(reply({ kind: 'event', title: 'Dinner', time: '19:30', place: 'Juniper Table' }))!)).toMatchObject({
      tool: 'write_event',
      payload: { on_date: '2026-10-15', all_day: false, starts: '19:30', location: 'Juniper Table' },
    })
    expect(fromExtract(msg, parseExtract(reply({ kind: 'event', date: null }))!).tool).toBe('write')
  })

  it('lets the subject rule outrank the model on kind', () => {
    const p = fromExtract(message('Invoice 42', [plain('...')]), parseExtract(reply({ kind: 'event' }))!)
    expect(p.tool).toBe('write')
  })
})

describe('rulesOnly', () => {
  it('proposes a task named for the subject, so the email still reaches Review', () => {
    expect(rulesOnly(message('Invoice 42 from Acme', [plain('...')]))).toMatchObject({
      tool: 'write',
      evidence: gmailLink('msg1'),
      confidence: 0.5,
      payload: { title: 'Invoice 42 from Acme', due_on: null, classified_by: 'rules' },
    })
  })
})

describe('tripItem', () => {
  // v1.2 phase 10a: a reservation for a day inside a trip waits in that trip's
  // inbox as a pending itinerary item instead of on Review.
  const invite = () =>
    proposalsFromIcs(
      message('Your reservation at Juniper Table', [{ mimeType: 'text/calendar', body: { data: b64(ICS) } }]),
      ZONE,
      NOW,
    )[0]
  const trips = [
    { id: 'trip-before', starts_on: '2026-09-01', ends_on: '2026-09-05' },
    { id: 'trip-sf', starts_on: '2026-10-08', ends_on: '2026-10-12' },
  ]

  it('is the trip whose dates cover the event, with the invite time and the message as its key', () => {
    expect(tripItem(invite(), trips)).toEqual({
      trip_id: 'trip-sf',
      title: 'Dinner at Juniper Table',
      occurs_on: '2026-10-10',
      occurs_at: '19:00',
      detail: '418 Example Ave, Portland',
      external_id: `${gmailLink('msg1')}#2026-10-10T19:00`,
      confidence: 1,
    })
  })

  it('is nothing for an event no trip covers, and nothing for a task', () => {
    expect(tripItem(invite(), [trips[0]])).toBeNull()
    expect(tripItem(rulesOnly(message('Invoice 42', [plain('...')])), trips)).toBeNull()
  })

  it('counts a trip with no end as its first day only', () => {
    expect(tripItem(invite(), [{ id: 'day', starts_on: '2026-10-10', ends_on: null }])?.trip_id).toBe('day')
    expect(tripItem(invite(), [{ id: 'day', starts_on: '2026-10-09', ends_on: null }])).toBeNull()
  })
})
