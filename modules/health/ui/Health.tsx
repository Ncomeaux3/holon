'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import {
  ActionButton,
  Card,
  Chip,
  EmptyState,
  Eyebrow,
  MetricStrip,
  MetricTile,
  PillGroup,
  Row,
  RowList,
  StatusChip,
  TabBar,
  fieldClass,
  useToast,
  type SkillLink,
} from '@/components/pos'
import { useSearchState } from '@/components/pos/searchState'
import { useOptimisticAction } from '@/components/pos/useOptimisticAction'
import { HIT } from '@/components/pos/button-classes'
import { cn } from '@/lib/utils'
import { dueOn, screeningStatus, type ScreeningStatus } from '../screening'
import { completeScreening, markMedication, snoozeScreening, type ActionResult } from './actions'
import { HealthDrawer } from './HealthDrawer'

// The Health page as the artboard draws it: a left pane of vitals tiles,
// appointments, medications and records, a right rail of what is owed, what
// cover costs and who to ring, and one drawer for an appointment, a record or
// the Log a visit form. Every list is the whole list; nothing hides behind a
// tab.

export type Appointment = {
  id: string
  what: string
  startsAt: string
  location: string
  status: string
  prep: string
  notes: string
  costCents: number | null
  providerId: string | null
  provider: string | null
  providerRole: string | null
  providerAddress: string | null
  entityRef: string | null
  skills: SkillLink[]
}

export type HealthRecord = {
  id: string
  title: string
  kind: string
  takenOn: string
  summary: string
  fields: Record<string, string>
  file: 'PDF' | 'IMAGE' | null
  entityRef: string | null
  skills: SkillLink[]
}

export type HealthData = {
  todayIso: string
  /** From the Fitness module through the registry, or null when it is not installed. */
  bodyWeightLb: number | null
  appointments: Appointment[]
  medications: {
    id: string
    name: string
    dose: string
    schedule: string
    startedOn: string | null
    refillOn: string | null
    ended: boolean
    taken: string[]
  }[]
  vitals: {
    metric: string
    value: number
    valueText: string
    measuredAt: string
    provenance: string
    prevValue: number | null
    prevMeasuredAt: string | null
  }[]
  records: HealthRecord[]
  screenings: {
    id: string
    name: string
    intervalMonths: number
    lastDoneOn: string | null
    snoozeUntil: string | null
  }[]
  providers: { id: string; name: string; role: string; phone: string; address: string; notes: string }[]
  /** From the Insurance module's digest, or empty when it wrote none. */
  coverage: { label: string; value: string }[]
  /** Every skill in the tree, id and name. From getSkillNames() on the page. */
  skills: [string, string][]
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "12 Mar 2026", the record date. */
export const recordDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`)
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** "Fri 18 Sep 2026, 08:30", the drawer's When row. */
export const longWhen = (iso: string) => {
  const d = new Date(iso)
  return `${DOWS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${d.toTimeString().slice(0, 5)}`
}

const monthYear = (iso: string) => {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((new Date(`${toIso}T12:00:00`).getTime() - new Date(`${fromIso}T12:00:00`).getTime()) / 86_400_000)

export const VITAL_LABELS: Record<string, string> = {
  blood_pressure: 'Blood pressure',
  ldl: 'LDL',
  hdl: 'HDL',
  triglycerides: 'Triglycerides',
  a1c: 'HbA1c',
  glucose: 'Fasting glucose',
  vitamin_d: 'Vitamin D',
  tsh: 'TSH',
}

export const KIND_LABEL: Record<string, string> = {
  lab: 'Lab',
  visit: 'Visit',
  imaging: 'Imaging',
  dental: 'Dental',
  vision: 'Vision',
  immunisation: 'Immunisation',
}

/** "Wed 1 Oct · 09:30", an appointment row's right column. */
const rowWhen = (iso: string) => {
  const d = new Date(iso)
  return `${DOWS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} · ${d.toTimeString().slice(0, 5)}`
}

function useParams() {
  const { params, set: setParams } = useSearchState()
  return { params, setParams }
}

/** The title block's "Log a visit": the form drawer, in the URL. */
export function LogVisitButton() {
  const { setParams } = useParams()
  return (
    <ActionButton variant="accent" size="lg" onClick={() => setParams({ new: '1', appt: null, record: null }, { push: true })}>
      Log a visit
    </ActionButton>
  )
}

const RECORD_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'lab', label: 'Labs' },
  { value: 'visit', label: 'Visits' },
  { value: 'imaging', label: 'Imaging' },
  { value: 'other', label: 'Other' },
] as const
type RecordFilter = (typeof RECORD_FILTERS)[number]['value']

export function Health({ data }: { data: HealthData }) {
  // Which appointment or record is open, and whether the form is, live in the
  // URL so a screenshot survives the theme reload and a row can be linked to.
  const { params, setParams } = useParams()
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')
  const [filter, setFilter] = useState<RecordFilter>('all')
  const [query, setQuery] = useState('')
  const [, start] = useTransition()
  const toast = useToast()

  const run = (action: () => Promise<ActionResult>, ok?: string) =>
    start(async () => {
      const result = await action()
      if (!result.ok) toast(result.error)
      else if (ok) toast(ok)
    })

  // A screening leaves the Due & overdue rail the moment Mark done or Snooze
  // is pressed, same shape as Inbox.tsx's act(): optimistic, reverted with a
  // toast on failure.
  const [gone, setGone] = useState<string[]>([])
  const flip = (id: string, action: () => Promise<ActionResult>, ok: string) => {
    setGone((g) => [...g, id])
    start(async () => {
      const result = await action()
      if (result.ok) toast(ok)
      else {
        setGone((g) => g.filter((x) => x !== id))
        toast(result.error)
      }
    })
  }
  const screenings = data.screenings.filter((s) => !gone.includes(s.id))

  const now = new Date()
  const isPast = (a: Appointment) => a.status === 'done' || a.status === 'cancelled' || new Date(a.startsAt) < now
  const upcoming = data.appointments.filter((a) => !isPast(a))
  const past = data.appointments.filter(isPast)
  const shownAppts = tab === 'upcoming' ? upcoming : past

  // Marking a medication taken flips it right away; the shape matches
  // Board's task-done reducer, one row patched in an array bound to a prop.
  const [medications, runMedication] = useOptimisticAction<
    HealthData['medications'],
    { id: string; taken: boolean },
    ActionResult
  >(data.medications, (state, patch) =>
    state.map((m) =>
      m.id === patch.id
        ? { ...m, taken: patch.taken ? [...m.taken, data.todayIso] : m.taken.filter((d) => d !== data.todayIso) }
        : m,
    ),
  )

  const active = medications.filter((m) => !m.ended)
  const takenToday = active.filter((m) => m.taken.includes(data.todayIso)).length
  const lowest = active
    .filter((m) => m.refillOn)
    .map((m) => ({ name: m.name, days: daysBetween(data.todayIso, m.refillOn!) }))
    .sort((a, b) => a.days - b.days)[0]

  const q = query.trim().toLowerCase()
  const records = data.records.filter((r) => {
    const inFilter =
      filter === 'all' ? true : filter === 'other' ? !['lab', 'visit', 'imaging'].includes(r.kind) : r.kind === filter
    return inFilter && (!q || `${r.title} ${r.summary} ${r.kind}`.toLowerCase().includes(q))
  })

  const openAppt = params.get('appt') ? (data.appointments.find((a) => a.id === params.get('appt')) ?? null) : null
  const openRecord = params.get('record') ? (data.records.find((r) => r.id === params.get('record')) ?? null) : null
  const drawerOpen = openAppt !== null || openRecord !== null || params.get('new') === '1'

  return (
    <div className="-mx-[18px] flex flex-wrap items-start border-t border-separator md:-mx-7">
      <div className="flex min-w-0 flex-[1_1_540px] flex-col gap-7 px-[18px] pb-10 pt-[22px] md:px-7">
        {data.vitals.length === 0 && data.bodyWeightLb === null ? (
          <p className="text-footnote text-secondary-label">No readings yet. Blood pressure, lipids and glucose live here; weight comes from Fitness.</p>
        ) : (
          <MetricStrip>
            {data.bodyWeightLb !== null && (
              <MetricTile size="sm" label="Weight" value={String(Math.round(data.bodyWeightLb))} delta="lb · from Fitness" />
            )}
            {data.vitals.map((v) => (
              <MetricTile
                key={v.metric}
                size="sm"
                label={VITAL_LABELS[v.metric] ?? v.metric}
                value={v.valueText || String(v.value)}
                delta={
                  v.prevValue !== null && v.metric !== 'blood_pressure'
                    ? `${v.value - v.prevValue > 0 ? '+' : ''}${Math.round((v.value - v.prevValue) * 10) / 10} · since ${monthYear(v.prevMeasuredAt!)} · ${v.provenance}`
                    : `${monthYear(v.measuredAt)} · ${v.provenance}`
                }
              />
            ))}
          </MetricStrip>
        )}

        <section>
          <TabBar
            label="Appointment views"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'upcoming', label: 'Upcoming', count: upcoming.length },
              { value: 'past', label: 'History', count: past.length },
            ]}
          />
          {shownAppts.length > 0 ? (
            <RowList className="mt-3.5">
              {shownAppts.map((a) => {
                const held = a.status === 'held'
                return (
                  <Row
                    key={a.id}
                    title={a.what}
                    meta={[a.provider, a.location].filter(Boolean).join(' · ')}
                    date={rowWhen(a.startsAt)}
                    muted={isPast(a)}
                    onClick={() => setParams({ appt: a.id, record: null, new: null }, { push: true })}
                    right={
                      <StatusChip tone={held ? 'warn' : isPast(a) ? 'quiet' : 'brand'}>
                        {a.status.charAt(0).toUpperCase() + a.status.slice(1)}
                      </StatusChip>
                    }
                  />
                )
              })}
            </RowList>
          ) : (
            <EmptyState headline={tab === 'upcoming' ? 'Nothing booked' : 'No history'} className="mt-3.5">
              {tab === 'upcoming' ? 'Nothing is on the calendar. Log a visit with a future date to add one.' : 'Nothing has happened yet.'}
            </EmptyState>
          )}
        </section>

        <section>
          <Eyebrow>Medications &amp; supplements</Eyebrow>
          {active.length > 0 && (
            <RowList className="mt-2.5">
              {active.map((m) => {
                const taken = m.taken.includes(data.todayIso)
                const days = m.refillOn ? daysBetween(data.todayIso, m.refillOn) : null
                return (
                  <Row
                    key={m.id}
                    title={[m.name, m.dose].filter(Boolean).join(' · ')}
                    meta={[m.schedule, m.startedOn ? `started ${monthYear(m.startedOn)}` : ''].filter(Boolean).join(' · ')}
                    right={
                      <>
                        {days !== null && (
                          <StatusChip tone={days < 0 ? 'bad' : days <= 10 ? 'warn' : 'quiet'}>
                            {days < 0 ? 'Refill overdue' : `${days} days left`}
                          </StatusChip>
                        )}
                        <ActionButton
                          size="sm"
                          variant={taken ? 'brand' : 'outline'}
                          aria-pressed={taken}
                          aria-label={`Taken today, ${m.name}`}
                          onClick={() => runMedication({ id: m.id, taken: !taken }, () => markMedication(m.id, !taken))}
                        >
                          {taken ? 'Taken today' : 'Mark taken'}
                        </ActionButton>
                      </>
                    }
                  />
                )
              })}
            </RowList>
          )}
          {active.length === 0 && <p className="mt-3 text-footnote text-secondary-label">Nothing prescribed.</p>}
          {active.length > 0 && (
            <p className="mt-3 text-footnote text-secondary-label">
              {takenToday} of {active.length} marked today.
              {lowest && lowest.days <= 10 && lowest.days >= 0 && ` ${lowest.name} is down to ${lowest.days} ${lowest.days === 1 ? 'day' : 'days'}.`}
              {lowest && lowest.days < 0 && ` ${lowest.name} is past its refill date.`}
            </p>
          )}
        </section>

        <section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Eyebrow>Records</Eyebrow>
            <div className="flex flex-wrap items-center gap-2.5">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search records"
                placeholder="Search records"
                className={cn(fieldClass, 'w-[180px] py-1.5')}
              />
              <PillGroup label="Record kind" value={filter} onChange={setFilter} options={[...RECORD_FILTERS]} />
            </div>
          </div>
          {records.length > 0 ? (
            <RowList className="mt-3.5">
              {records.map((r) => (
                <Row
                  key={r.id}
                  title={r.title}
                  meta={r.summary || undefined}
                  date={recordDate(r.takenOn)}
                  onClick={() => setParams({ record: r.id, appt: null, new: null }, { push: true })}
                  right={
                    <>
                      <StatusChip tone={r.kind === 'lab' ? 'brand' : r.kind === 'imaging' ? 'warn' : 'neutral'}>
                        {KIND_LABEL[r.kind] ?? r.kind}
                      </StatusChip>
                      <Chip tone="quiet">{r.file ?? 'No file'}</Chip>
                    </>
                  }
                />
              ))}
            </RowList>
          ) : (
            <EmptyState headline={data.records.length === 0 ? 'No records' : 'No matches'} className="mt-3.5">
              {data.records.length === 0 ? 'Log a visit with a past date to file one.' : q ? `Nothing in this filter matches "${query.trim()}".` : 'Nothing in this filter.'}
            </EmptyState>
          )}
        </section>
      </div>

      <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-[26px] border-t border-separator px-[18px] pb-10 pt-[22px] xl:max-w-[400px] md:px-6">
        <section>
          <Eyebrow>Due &amp; overdue</Eyebrow>
          {screenings.map((s) => {
            const status = screeningStatus(s, data.todayIso)
            const booked = upcoming.find((a) => a.what.toLowerCase() === s.name.toLowerCase())
            const state: ScreeningStatus | 'scheduled' = booked ? 'scheduled' : status
            if (state === 'ok' || state === 'snoozed') return null
            const due = dueOn(s)
            const label =
              state === 'scheduled'
                ? `Booked for ${new Date(booked!.startsAt).getDate()} ${MONTHS[new Date(booked!.startsAt).getMonth()]}`
                : s.lastDoneOn
                  ? `Last done ${monthYear(s.lastDoneOn)} · ${Math.round(-daysBetween(data.todayIso, s.lastDoneOn) / 30)} months ago`
                  : 'No date on record'
            return (
              <Card key={s.id} as="article" className={cn('mt-2.5', state === 'overdue' && 'ring-1 ring-red-text')}>
                <div className="flex items-center justify-between gap-2.5">
                  <StatusChip tone={state === 'overdue' ? 'bad' : state === 'scheduled' ? 'brand' : state === 'never' ? 'quiet' : 'warn'}>
                    {state === 'scheduled' ? 'Scheduled' : state === 'overdue' ? 'Overdue' : state === 'never' ? 'Never done' : 'Due soon'}
                  </StatusChip>
                  <span className="num text-footnote text-secondary-label">Every {s.intervalMonths} mo</span>
                </div>
                <p className="mt-2.5 text-subheadline font-medium text-label">{s.name}</p>
                <p className="text-caption-1 mt-0.5 text-secondary-label">
                  {label}
                  {due && state !== 'scheduled' && state !== 'never' ? ` · due ${new Date(`${due}T12:00:00`).getDate()} ${MONTHS[new Date(`${due}T12:00:00`).getMonth()]}` : ''}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {state === 'scheduled' ? (
                    <ActionButton size="sm" onClick={() => setParams({ appt: booked!.id, record: null, new: null }, { push: true })}>
                      View appointment
                    </ActionButton>
                  ) : (
                    <>
                      <ActionButton size="sm" variant="accent" onClick={() => flip(s.id, () => completeScreening(s.id), `${s.name} recorded`)}>
                        Mark done
                      </ActionButton>
                      <ActionButton size="sm" onClick={() => flip(s.id, () => snoozeScreening(s.id, 3), 'Pushed out three months')}>
                        Snooze 3 mo
                      </ActionButton>
                    </>
                  )}
                </div>
              </Card>
            )
          })}
          {screenings.every((s) => ['ok', 'snoozed'].includes(screeningStatus(s, data.todayIso))) && (
            <p className="mt-3 text-footnote text-secondary-label">Nothing is owed.</p>
          )}
        </section>

        <section>
          <Eyebrow>Insurance &amp; cost</Eyebrow>
          {data.coverage.length > 0 && (
            <RowList className="mt-2.5">
              {data.coverage.map((c) => (
                <Row key={c.label} title={<span className="text-footnote font-normal">{c.label}</span>} amount={c.value} />
              ))}
            </RowList>
          )}
          <p className="mt-3 text-footnote text-secondary-label">
            {data.coverage.length === 0 ? 'No health, dental or vision policy from Insurance yet: its nightly digest is where these come from. ' : ''}
            Plan details live in{' '}
            <Link href="/insurance" className={cn(HIT, 'inline-block text-secondary-label underline decoration-gray underline-offset-4 hover:text-label')}>
              Insurance
            </Link>
            .
          </p>
        </section>

        <section>
          <Eyebrow>Care team</Eyebrow>
          {data.providers.length > 0 && (
            <RowList className="mt-2.5">
              {data.providers.map((p) => (
                <Row
                  key={p.id}
                  title={p.name}
                  meta={[p.phone, p.address || p.notes].filter(Boolean).join(' · ')}
                  right={<Chip tone="quiet">{p.role}</Chip>}
                />
              ))}
            </RowList>
          )}
          {data.providers.length === 0 && <p className="mt-3 text-footnote text-secondary-label">Nobody yet.</p>}
        </section>
      </aside>

      {drawerOpen && (
        <HealthDrawer
          appointment={openAppt}
          record={openRecord}
          isNew={params.get('new') === '1'}
          providers={data.providers}
          todayIso={data.todayIso}
          skills={data.skills}
          onClose={() => setParams({ appt: null, record: null, new: null })}
          onRun={run}
        />
      )}
    </div>
  )
}
