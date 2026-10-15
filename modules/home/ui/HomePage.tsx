import { readMetric } from '@/core/metrics'
import { getSkillNames } from '@/core/modules'
import { listSkillLinks } from '@/core/skill-links'
import {
  listAssets,
  listServiceLog,
  listServices,
  listVendors,
  listWarranties,
  ownerToday,
  toSchedule,
} from '../data'
import { dueStatus, nextDue } from '../schedule'
import { Home, type HomeData } from './Home'

export default async function HomePage() {
  const [assets, services, log, warranties, vendors, todayIso, propertyPremium, links, names] = await Promise.all([
    listAssets(),
    listServices(),
    listServiceLog(),
    listWarranties(),
    listVendors(),
    ownerToday(),
    // What the house is insured for belongs to Insurance. Read through the
    // registry rather than kept here twice, so there is one number and it is
    // simply absent when Insurance is not installed.
    readMetric('insurance.property_premium'),
    listSkillLinks('home', 'asset'),
    getSkillNames(),
  ])

  const data: HomeData = {
    todayIso,
    propertyPremium,
    assets: assets.map((a) => ({
      id: a.id,
      kind: a.kind,
      name: a.name,
      subtitle: a.subtitle,
      valueCents: Number(a.value_cents),
      annualCostCents: Number(a.annual_cost_cents),
      valueAsOf: a.value_as_of,
      acquiredOn: a.acquired_on,
      notes: a.notes,
      facts: a.facts,
      entityRef: links.get(a.id)?.entityRef ?? null,
      skills: links.get(a.id)?.skills ?? [],
    })),
    services: services.map((s) => ({
      id: s.id,
      assetId: s.asset_id,
      assetName: s.asset_name,
      title: s.title,
      intervalMonths: s.interval_months,
      lastDoneOn: s.last_done_on,
      // Derived here rather than stored, so the calendar can never disagree
      // with the history it was computed from.
      dueOn: nextDue(toSchedule(s)),
      status: dueStatus(toSchedule(s), todayIso),
      snoozeUntil: s.snooze_until,
      costEstimateCents: s.cost_estimate_cents,
      vendorId: s.vendor_id,
      vendorName: s.vendor_name,
      notes: s.notes,
    })),
    log: log.map((l) => ({
      id: l.id,
      assetId: l.asset_id,
      what: l.what,
      doneOn: l.done_on,
      costCents: l.cost_cents,
      vendorName: l.vendor_name,
    })),
    warranties: warranties.map((w) => ({
      id: w.id,
      assetId: w.asset_id,
      name: w.name,
      detail: w.detail,
      cover: w.cover,
      expiresOn: w.expires_on,
      documentUrl: w.document_url,
      facts: w.facts,
    })),
    vendors: vendors.map((v) => ({
      id: v.id,
      name: v.name,
      trade: v.trade,
      contact: v.contact,
      lastUsedOn: v.last_used_on,
      lastCostCents: v.last_cost_cents,
    })),
    skills: Object.entries(names),
  }

  return <Home data={data} />
}
