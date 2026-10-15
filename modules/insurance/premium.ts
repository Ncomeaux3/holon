// Premiums, expiry and masking. No imports: the Insurance screen is a client
// component and anything reaching core/db.ts drags pg into the browser bundle.
//
// Nothing here judges a policy. Per SPEC section 8 as amended on 2026-09-07,
// this module records what the declarations page says and computes dates and
// totals from it. No gap analysis, no adequacy scoring, no opinion about
// whether cover is enough.

export type Cadence = 'monthly' | 'quarterly' | 'semiannual' | 'annual'

export type PolicyStatus = 'expired' | 'renew-now' | 'expiring' | 'active' | 'undated'

/** How many times a year each cadence bills. */
const PER_YEAR: Record<Cadence, number> = {
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
}

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000

/** What a year of this policy costs, in cents. */
export function annualCents(premiumCents: number, cadence: Cadence): number {
  return premiumCents * PER_YEAR[cadence]
}

export type TypeBreakdown = Record<string, { annualCents: number; active: number; expiring: number }>

/**
 * The digest's per-kind figures, so a reader such as Health can pick the
 * kinds that are its business (health, dental, vision) and skip the car.
 * Only active policies count; `expiring` is inside sixty days or already past.
 */
export function byType(
  policies: { kind: string; status: string; premium_cents: number; cadence: string; expires_on: string | null }[],
  todayIso: string,
): TypeBreakdown {
  const out: TypeBreakdown = {}
  for (const p of policies) {
    if (p.status !== 'active') continue
    const row = (out[p.kind] ??= { annualCents: 0, active: 0, expiring: 0 })
    row.annualCents += annualCents(p.premium_cents, p.cadence as Cadence)
    row.active += 1
    const status = policyStatus(p.expires_on, todayIso)
    if (status === 'expired' || status === 'renew-now' || status === 'expiring') row.expiring += 1
  }
  return out
}

export const CADENCE_LABELS: Record<Cadence, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semiannual: 'Every 6 months',
  annual: 'Annually',
}

/** Whole days until expiry. Negative once it has passed. */
export function daysUntil(expiresOn: string | null, todayIso: string): number | null {
  if (!expiresOn) return null
  return day(expiresOn) - day(todayIso)
}

/**
 * Where a policy stands.
 *
 * `undated` is its own state. A policy with no expiry on file is not active
 * and not expired: nobody has written the date down yet, and calling it active
 * would be the screen making a claim on no evidence.
 */
export function policyStatus(expiresOn: string | null, todayIso: string): PolicyStatus {
  const days = daysUntil(expiresOn, todayIso)
  if (days === null) return 'undated'
  if (days < 0) return 'expired'
  if (days <= 30) return 'renew-now'
  if (days <= 60) return 'expiring'
  return 'active'
}

export const STATUS_LABELS: Record<PolicyStatus, string> = {
  expired: 'Expired',
  'renew-now': 'Renew now',
  expiring: 'Expiring',
  active: 'Active',
  undated: 'No date on file',
}

/**
 * The last four characters, letters and digits only.
 *
 * Punctuation is dropped first so that a number written 918-44-2210-8 and the
 * same number written 918442210-8 mask the same way. Anything shorter than
 * four characters is not masked at all: there would be nothing left to show.
 */
export function maskNumber(policyNumber: string): string {
  const clean = policyNumber.replace(/[^A-Za-z0-9]/g, '')
  if (clean.length === 0) return 'not on file'
  return `•••• ${clean.slice(-4)}`
}

/**
 * The date the next term would end, if the policy renews as it stands.
 *
 * A six month policy renews to six months on, everything else to a year. This
 * is what the Mark renewed button offers, and it is only ever an offer: the
 * owner types the real date when the carrier says something different.
 */
export function nextTermEnd(expiresOn: string, cadence: Cadence): string {
  return addMonths(expiresOn, cadence === 'semiannual' ? 6 : 12)
}

/** The same day of month `months` on, clamped to the month's last day. */
function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, lastDay))
  return target.toISOString().slice(0, 10)
}

/** "in 36 days", "8 days ago", "no date on file". */
export function expiryLabel(expiresOn: string | null, todayIso: string): string {
  const days = daysUntil(expiresOn, todayIso)
  if (days === null) return 'no date on file'
  if (days === 0) return 'today'
  if (days < 0) return `${Math.abs(days)} days ago`
  return `in ${days} days`
}

/**
 * Which reminder leads fall on today, for a policy expiring on this date.
 *
 * Returned rather than queued here so the nightly job stays the only thing
 * that writes notifications, and so this can be tested without a database.
 */
export function remindersDueToday(
  expiresOn: string | null,
  leads: number[],
  todayIso: string,
): number[] {
  const days = daysUntil(expiresOn, todayIso)
  if (days === null || days < 0) return []
  return leads.filter((lead) => lead === days)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Oct 18", or "Jan 2 2027" when the year is not this one. Without a today, the year is always written. */
export function shortDate(iso: string, todayIso?: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}${todayIso && y === Number(todayIso.slice(0, 4)) ? '' : ` ${y}`}`
}

/** "37 days", "today", "12d ago", "no date". The table's and the drawer's big figure. */
export function daysLabel(expiresOn: string | null, todayIso: string): string {
  const days = daysUntil(expiresOn, todayIso)
  if (days === null) return 'no date'
  if (days === 0) return 'today'
  if (days < 0) return `${Math.abs(days)}d ago`
  return `${days} days`
}

const CADENCE_TAGS: Record<Cadence, string> = {
  monthly: '/mo',
  quarterly: '/3mo',
  semiannual: '/6mo',
  annual: '/yr',
}

export function cadenceTag(cadence: Cadence): string {
  return CADENCE_TAGS[cadence]
}

/** "60d · 14d · day of", longest lead first; "off" when there are none. */
export function leadsLabel(leads: number[]): string {
  if (leads.length === 0) return 'off'
  return leads
    .slice()
    .sort((a, b) => b - a)
    .map((l) => (l === 0 ? 'day of' : `${l}d`))
    .join(' · ')
}

/**
 * Where each reminder sits on a track from today (0) to the expiry (100), as
 * a percentage to one decimal, and whether it has already fired.
 */
export function reminderMarks(leads: number[], days: number): { lead: number; at: number; fired: boolean }[] {
  const span = Math.max(days, 1)
  return leads.map((lead) => ({
    lead,
    at: Math.round(Math.max(0, Math.min(100, (1 - lead / span) * 100)) * 10) / 10,
    fired: lead >= days,
  }))
}

/**
 * Billing dates stepped back from the expiry by the cadence: the term ends on
 * the expiry, so a monthly policy expiring on the 18th bills on the 18th. One
 * date behind today and three ahead. These are inferred dates, not payments:
 * the app records none, so nothing here is ever labelled paid.
 */
export function paymentSchedule(
  expiresOn: string,
  cadence: Cadence,
  todayIso: string,
): { label: 'Last' | 'Next' | 'Upcoming'; on: string }[] {
  const months = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 }[cadence]
  const at = (k: number) => addMonths(expiresOn, k * months)
  // Walk back until the date is on or before today: that is "Last".
  let k = 0
  while (at(k) > todayIso) k--
  return [
    { label: 'Last', on: at(k) },
    { label: 'Next', on: at(k + 1) },
    { label: 'Upcoming', on: at(k + 2) },
    { label: 'Upcoming', on: at(k + 3) },
  ]
}

/** Capitalises the first letter: a kind or a free-form status read title case. */
export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** "$7,901.88", "$14", "$13.49": cents shown only when there are some. */
export function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

/**
 * Whether Finance holds this policy's premium: posting is on, the policy is
 * active and not past its expiry (cover that ended bills nothing), and it has
 * an expiry to step the billing dates back from and a premium. The screens
 * read the same test, so "In Finance" is never a claim Finance cannot back.
 */
export function inFinance(
  policy: { postToFinance: boolean; status: string; expiresOn: string | null; premiumCents: number },
  todayIso: string,
): boolean {
  return (
    policy.postToFinance &&
    policy.status === 'active' &&
    policy.expiresOn !== null &&
    policy.expiresOn >= todayIso &&
    policy.premiumCents > 0
  )
}

/**
 * What finance.write_recurring is sent for a policy, or null when Finance
 * should hold nothing for it (see inFinance).
 * Finance names a yearly cadence `yearly`, and files the row under Insurance
 * premiums so its budget row can show the monthly equivalent as set aside.
 */
export function premiumPost(
  policy: {
    id: string
    name: string
    premium_cents: number
    cadence: Cadence
    expires_on: string | null
    status: string
    post_to_finance: boolean
  },
  todayIso: string,
) {
  const held = inFinance(
    {
      postToFinance: policy.post_to_finance,
      status: policy.status,
      expiresOn: policy.expires_on,
      premiumCents: policy.premium_cents,
    },
    todayIso,
  )
  if (!held || !policy.expires_on) return null
  const [last, next] = paymentSchedule(policy.expires_on, policy.cadence, todayIso)
  return {
    source: 'insurance',
    external_id: policy.id,
    name: policy.name,
    amount_cents: policy.premium_cents,
    cadence: policy.cadence === 'annual' ? ('yearly' as const) : policy.cadence,
    last_charge_on: last.on,
    next_charge_on: next.on,
    category: 'Insurance premiums',
  }
}
