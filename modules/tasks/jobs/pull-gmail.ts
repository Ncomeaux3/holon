import { isoDateIn } from '@/core/clock'
import { db } from '@/core/db'
import { complete } from '@/core/llm'
import { propose } from '@/core/proposals'
import { getSetting } from '@/core/settings'
import { callQuery, callTool } from '@/core/tools'
import { GoogleError, gmailMessage, gmailMessageIds, googleCredentials } from '@/integrations/google/client'
import {
  AGENT,
  fromExtract,
  gmailLink,
  icsText,
  parseExtract,
  prompt,
  type ProposalArgs,
  proposalsFromIcs,
  rulesOnly,
  SYSTEM,
  type TripSpan,
  tripItem,
} from '../gmail-rules'

// Mail the owner labels POS into proposals on the Review screen, read only.
//
// The last 30 days of the label each run, not Gmail's history ids, for the
// reason 7a's pull reads a full window: nothing to store, and a missed night
// mends itself. A message already proposed (pending, approved or dismissed) is
// known by its link in core.proposals.evidence and skipped before anything is
// fetched or sent to the model.

async function proposalsFor(
  msg: Awaited<ReturnType<typeof gmailMessage>>,
  zone: string,
  now: Date,
): Promise<ProposalArgs[]> {
  const fromInvite = proposalsFromIcs(msg, zone, now)
  if (fromInvite.length) return fromInvite
  // An invite with nothing to put on the calendar (a cancellation, a date
  // outside the window) is still never sent to the model: /privacy says so.
  if (icsText(msg)) return [rulesOnly(msg)]

  try {
    const reply = await complete({
      model: 'claude-haiku-4-5',
      purpose: 'mail',
      module: 'tasks',
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt(msg, isoDateIn(now, zone), zone) }],
      maxTokens: 300,
    })
    const extract = parseExtract(reply)
    if (extract) return [fromExtract(msg, extract)]
  } catch (error) {
    // Not connected, over the cap, or the call failed: the rules' reading
    // still reaches Review, so the message is not lost or retried for money.
    console.error(`pull_gmail: model reading of ${msg.id} failed:`, error)
  }
  return [rulesOnly(msg)]
}

/**
 * Never skips silently: not connected, or connected without Gmail, returns a
 * skipped result that says so, and any other Google failure throws so the job
 * row says failed.
 */
export async function pullGmail(now = new Date()) {
  const creds = await googleCredentials()
  if (!creds?.access_token) {
    return { skipped: true, messages: 0, proposals: 0, cents: 0, detail: 'Google is not connected.' }
  }

  let ids: string[]
  try {
    ids = await gmailMessageIds(creds.access_token)
  } catch (error) {
    // Calendar works on a grant from before Gmail, so this is a step the owner
    // has not taken yet (OWNER-TODO 28), not a broken job: skipped, with the
    // sentence that says which step.
    if (error instanceof GoogleError && error.status === 403) {
      return { skipped: true, messages: 0, proposals: 0, cents: 0, detail: error.message }
    }
    throw error
  }
  const { rows } = await db().query<{ evidence: string }>(
    `select distinct evidence from core.proposals where agent = $1 and evidence = any($2)`,
    [AGENT, ids.map(gmailLink)],
  )
  // A reservation for a day of a trip went to that trip's inbox instead
  // (v1.2 phase 10a), so the trip's items are known mail too. Read through
  // callQuery, the agent's read path, scoped to travel and core; the SQL takes
  // nothing from outside.
  const taken = (await callQuery(
    'travel',
    `select external_id from travel.itinerary_item
      where source = 'agent' and external_id like 'https://mail.google.com/%'`,
  )) as { external_id: string }[]
  // A trip item's key is the Gmail link, #, then the event's day and time.
  // The link holds a # of its own (#all/<id>), so the last one is the cut.
  const known = new Set([
    ...rows.map((r) => r.evidence),
    ...taken.map((r) => r.external_id.slice(0, r.external_id.lastIndexOf('#'))),
  ])
  const fresh = ids.filter((id) => !known.has(gmailLink(id)))
  const trips = (await callQuery(
    'travel',
    `select id, starts_on::text, ends_on::text from travel.trip
      where status in ('planned', 'booked') and starts_on is not null`,
  )) as TripSpan[]

  const zone = await getSetting('timezone')
  const started = new Date()
  let proposals = 0
  let items = 0
  for (const id of fresh) {
    const msg = await gmailMessage(creds.access_token, id)
    for (const args of await proposalsFor(msg, zone, now)) {
      const item = tripItem(args, trips)
      if (item) {
        const written = await callTool('travel', 'write_item', item, {
          source: 'agent',
          agent: AGENT,
          reason: args.reason,
          title: `Itinerary item from Gmail: ${item.title}`,
          confidence: item.confidence,
          evidence: args.evidence,
          affects: 'Travel',
        })
        // Under `observe` the write is a proposal on Review instead, which
        // the proposals count already describes.
        if (written.status === 'proposed') proposals++
        else items++
        continue
      }
      await propose(args)
      proposals++
    }
  }

  const spent = await db().query<{ cents: string | null }>(
    `select sum(cost_cents)::text as cents from core.llm_calls
      where purpose = 'mail' and occurred_at >= $1`,
    [started],
  )
  const cents = Number(spent.rows[0]?.cents ?? 0)

  return {
    skipped: false,
    messages: fresh.length,
    proposals,
    items,
    cents,
    detail: `${fresh.length} new of ${ids.length} labelled messages, ${proposals} proposals, ${items} to a trip's inbox, ${cents.toFixed(2)} cents.`,
  }
}
