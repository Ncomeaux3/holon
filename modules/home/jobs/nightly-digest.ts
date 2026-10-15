import { listAssets, listServices, listWarranties, ownerToday, toSchedule } from '../data'
import { dueLabel, dueStatus, monthKey, nextDue } from '../schedule'

export type HomeDigest = {
  /** Service that is late or falls in this month. */
  dueNow: { title: string; asset: string; when: string; costEstimateCents: number }[]
  /** What the next twelve months are estimated to cost, in cents. */
  yearEstimateCents: number
  /** Warranties running out in the next ninety days. */
  warrantiesExpiring: { name: string; expiresOn: string }[]
  assets: number
  /** The owner's own valuations added up, in cents. Not a market quote. */
  valueCents: number
}

/** Warranty cover worth mentioning before it runs out. */
const EXPIRY_WINDOW_DAYS = 90

export async function nightlyDigest(): Promise<HomeDigest> {
  const today = await ownerToday()
  const [assets, services, warranties] = await Promise.all([
    listAssets(),
    listServices(),
    listWarranties(),
  ])

  const withDue = services.map((s) => ({
    service: s,
    due: nextDue(toSchedule(s)),
    status: dueStatus(toSchedule(s), today),
  }))

  const horizon = new Date(`${today}T00:00:00Z`)
  horizon.setUTCDate(horizon.getUTCDate() + EXPIRY_WINDOW_DAYS)
  const horizonIso = horizon.toISOString().slice(0, 10)

  return {
    dueNow: withDue
      .filter((s) => s.status === 'overdue' || s.status === 'due')
      .map((s) => ({
        title: s.service.title,
        asset: s.service.asset_name,
        when: dueLabel(toSchedule(s.service), today),
        costEstimateCents: s.service.cost_estimate_cents,
      })),

    // A snoozed job still costs money when it happens, so it counts here. The
    // snooze hides the nag, not the bill.
    yearEstimateCents: withDue
      .filter((s) => s.due !== null && s.due >= `${monthKey(today)}-01` && s.due <= addYear(today))
      .reduce((sum, s) => sum + s.service.cost_estimate_cents, 0),

    warrantiesExpiring: warranties
      .filter((w) => w.expires_on !== null && w.expires_on <= horizonIso)
      .map((w) => ({ name: w.name, expiresOn: w.expires_on! })),

    assets: assets.length,
    valueCents: assets.reduce((sum, a) => sum + Number(a.value_cents), 0),
  }
}

function addYear(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCFullYear(d.getUTCFullYear() + 1)
  return d.toISOString().slice(0, 10)
}
