import { readFileSync } from 'node:fs'
import { isoDateIn } from '@/core/clock'
import { db } from '@/core/db'
import { propose } from '@/core/proposals'
import { getSetting } from '@/core/settings'
import { proposalsFromIcs } from '@/modules/tasks/gmail-rules'

// The Gmail e2e's fixture, run by that test alone so the shared seed's
// proposal counts stay what the Review tests were written against. Gmail
// itself is the one thing not here: a message as the API returns it, with the
// fixture invite attached for tonight, goes through the job's own rules.
// Local only, for the reason e2e/seed.mts gives.
if (!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('e2e/gmail.mts refuses to run: DATABASE_URL is not a local database.')
}

const zone = await getSetting('timezone')
const day = isoDateIn(new Date(), zone).replaceAll('-', '')
const ics = readFileSync(new URL('./fixtures/gmail-invite.ics', import.meta.url), 'utf8').replaceAll('{{DAY}}', day)

await db().query(`delete from core.proposals where agent = 'gmail'`)
await db().query(`delete from calendar.event where source = 'agent' and title = 'Dinner at Juniper Table'`)

const [proposal] = proposalsFromIcs(
  {
    id: 'e2e-gmail-1',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'Subject', value: 'Your reservation at Juniper Table' },
        { name: 'From', value: 'Juniper Table <reservations@example.com>' },
      ],
      parts: [
        { mimeType: 'text/plain', body: { data: Buffer.from('See you tonight.').toString('base64url') } },
        { mimeType: 'application/ics', filename: 'invite.ics', body: { data: Buffer.from(ics).toString('base64url') } },
      ],
    },
  },
  zone,
)
await propose(proposal)
await db().end()
