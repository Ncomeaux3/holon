import { queue } from '@/core/notify'
import { listPolicies, ownerToday } from '../data'
import { postPremium } from '../post'
import { annualCents, byType, expiryLabel, policyStatus, remindersDueToday, type Cadence, type TypeBreakdown } from '../premium'

export type InsuranceDigest = {
  /** Expiring inside sixty days, or already expired. */
  expiring: { name: string; carrier: string; expiresOn: string | null; when: string }[]
  /** What a year of every active policy comes to, in cents. */
  annualCents: number
  active: number
  /** The same three figures per policy kind, for a reader that wants only some kinds. */
  byType: TypeBreakdown
  /** Reminders queued by this run. */
  remindersSent: number
}

/**
 * The numbers, and nothing else. `get_digest` runs this after every insurance
 * write (core/tools.ts) and the goal metrics read it, so it must not queue:
 * a reminder per policy edit was one email row per edit. The queueing is
 * `remind` below, the nightly job.
 */
export async function nightlyDigest(): Promise<InsuranceDigest> {
  const [policies, today] = await Promise.all([listPolicies(), ownerToday()])
  const active = policies.filter((p) => p.status === 'active')

  const expiring = active.filter((p) => {
    const status = policyStatus(p.expires_on, today)
    return status === 'expired' || status === 'renew-now' || status === 'expiring'
  })

  return {
    expiring: expiring.map((p) => ({
      name: p.name,
      carrier: p.carrier,
      expiresOn: p.expires_on,
      when: expiryLabel(p.expires_on, today),
    })),
    annualCents: active.reduce(
      (sum, p) => sum + annualCents(p.premium_cents, p.cadence as Cadence),
      0,
    ),
    active: active.length,
    byType: byType(policies, today),
    remindersSent: 0,
  }
}

/** The nightly job: one notification per lead that lands today, then the digest. */
export async function remind(): Promise<InsuranceDigest> {
  const [policies, today] = await Promise.all([listPolicies(), ownerToday()])

  // Queued, not sent: the sender bundles the day's rows into one email.
  let remindersSent = 0
  for (const policy of policies.filter((p) => p.status === 'active')) {
    for (const lead of remindersDueToday(policy.expires_on, policy.reminder_leads, today)) {
      await queue({
        title: `${policy.name} expires in ${lead} days`,
        body: `${policy.carrier} / ${policy.expires_on}. Renewing keeps the same row, so the history stays in one place.`,
        urgency: lead <= 7 ? 'urgent' : 'normal',
        href: '/insurance',
      })
      remindersSent++
    }
  }

  // Cover that ended unrenewed bills nothing, so its premium leaves Finance.
  // Here and not in nightlyDigest: that is get_digest, which runs after every
  // write. As the owner, as Travel's nightly tag_trip does: the owner turned
  // posting on, and this only follows the policy's own date.
  for (const policy of policies.filter((p) => p.post_to_finance && p.expires_on && p.expires_on < today)) {
    await postPremium(policy.id, { source: 'ui' })
  }

  return { ...(await nightlyDigest()), remindersSent }
}
