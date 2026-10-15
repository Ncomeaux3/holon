import { Eyebrow, PageHeader } from '@/components/pos'
import { getDigest } from '@/core/digests'
import { readMetric } from '@/core/metrics'
import { getSkillNames } from '@/core/modules'
import { listSkillLinks } from '@/core/skill-links'
import { ownerToday } from '@/core/today'
import {
  latestVitals,
  listAppointments,
  listMedications,
  listProviders,
  listRecords,
  listScreenings,
} from '../data'
import { screeningStatus } from '../screening'
import { Health, LogVisitButton, type HealthData } from './Health'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default async function HealthPage() {
  const [
    appointments,
    medications,
    vitals,
    records,
    screenings,
    providers,
    todayIso,
    bodyWeight,
    insurance,
    recordLinks,
    apptLinks,
    names,
  ] =
    await Promise.all([
      listAppointments(),
      listMedications(),
      latestVitals(),
      listRecords(),
      listScreenings(),
      listProviders(),
      ownerToday(),
      // Body weight belongs to Fitness. Read through the registry rather than
      // duplicated into a health.vital row, so there is one source of truth and
      // it is simply absent when that module is not installed.
      readMetric('fitness.body_weight'),
      // What health cover costs, from the Insurance module's digest. Through
      // core.digests rather than the insurance schema: this module reads no
      // other module's tables, and an Insurance that has not run tonight
      // contributes no line rather than an error.
      getDigest('insurance'),
      listSkillLinks('health', 'record'),
      listSkillLinks('health', 'appointment'),
      getSkillNames(),
    ])

  const money = (cents: number) =>
    `$${Math.round(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`

  // Health-type policies only (v1.2): the digest's whole-module totals put the
  // car on this card. Summed over the kinds that are health cost; a digest
  // written before byType existed, or one with no such policy, shows nothing.
  const byType = insurance?.byType as Record<string, { annualCents: number; active: number; expiring: number }> | undefined
  const health = ['health', 'dental', 'vision'].map((kind) => byType?.[kind]).filter((row) => row !== undefined)
  const annual = health.length > 0 ? health.reduce((sum, r) => sum + r.annualCents, 0) : null
  const active = health.length > 0 ? health.reduce((sum, r) => sum + r.active, 0) : null
  const expiring = health.length > 0 ? health.reduce((sum, r) => sum + r.expiring, 0) : null

  const data: HealthData = {
    todayIso,
    bodyWeightLb: bodyWeight,
    coverage: [
      ...(annual === null ? [] : [{ label: 'Premiums a year', value: money(annual) }]),
      ...(annual === null ? [] : [{ label: 'A month', value: money(Math.round(annual / 12)) }]),
      ...(active === null ? [] : [{ label: 'Active policies', value: String(active) }]),
      ...(expiring ? [{ label: 'Expiring inside 60 days', value: String(expiring) }] : []),
    ],
    appointments: appointments.map((a) => ({
      id: a.id,
      what: a.what,
      startsAt: new Date(a.starts_at).toISOString(),
      location: a.location,
      status: a.status,
      prep: a.prep,
      notes: a.notes,
      costCents: a.cost_estimate_cents,
      providerId: a.provider_id,
      provider: a.provider_name,
      providerRole: a.provider_role,
      providerAddress: a.provider_address,
      entityRef: apptLinks.get(a.id)?.entityRef ?? null,
      skills: apptLinks.get(a.id)?.skills ?? [],
    })),
    medications: medications.map((m) => ({
      id: m.id,
      name: m.name,
      dose: m.dose,
      schedule: m.schedule,
      startedOn: m.started_on,
      refillOn: m.refill_on,
      ended: m.ended_on !== null,
      taken: m.taken,
    })),
    vitals: vitals.map((v) => ({
      metric: v.metric,
      value: Number(v.value),
      valueText: v.value_text,
      measuredAt: new Date(v.measured_at).toISOString(),
      provenance: v.provenance,
      prevValue: v.prev_value === null ? null : Number(v.prev_value),
      prevMeasuredAt: v.prev_measured_at === null ? null : new Date(v.prev_measured_at).toISOString(),
    })),
    records: records.map((r) => ({
      id: r.id,
      title: r.title,
      kind: r.kind,
      takenOn: r.taken_on,
      summary: r.summary,
      fields: r.fields,
      file: r.file_path === null ? null : /\.(png|jpe?g|webp|heic|gif)$/i.test(r.file_path) ? 'IMAGE' : 'PDF',
      entityRef: recordLinks.get(r.id)?.entityRef ?? null,
      skills: recordLinks.get(r.id)?.skills ?? [],
    })),
    screenings: screenings.map((s) => ({
      id: s.id,
      name: s.name,
      intervalMonths: s.interval_months,
      lastDoneOn: s.last_done_on,
      snoozeUntil: s.snooze_until,
    })),
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      phone: p.phone,
      address: p.address,
      notes: p.notes,
    })),
    skills: Object.entries(names),
  }

  const now = new Date()
  const next = data.appointments.find((a) => new Date(a.startsAt) >= now && a.status !== 'cancelled')
  const overdue = data.screenings.filter((s) => screeningStatus(s, todayIso) === 'overdue').length
  const nextLabel = next
    ? `next visit ${new Date(next.startsAt).getDate()} ${MONTHS[new Date(next.startsAt).getMonth()]}`
    : 'nothing booked'

  return (
    <div className="space-y-[22px]">
      <PageHeader
        eyebrow="Health / Overview"
        status={
          <Eyebrow dot={overdue > 0 ? 'bad' : 'brand'} className="whitespace-nowrap">
            {overdue > 0 ? `${overdue} screening${overdue === 1 ? '' : 's'} overdue` : 'Nothing overdue'} · {nextLabel}
          </Eyebrow>
        }
        title="Health"
        lede="Appointments, medications, vitals and documents in one place. Vitals that Fitness already reads are pulled in rather than typed twice."
        actions={<LogVisitButton />}
      />
      <Health data={data} />
    </div>
  )
}
