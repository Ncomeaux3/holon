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
  PageHeader,
  PillGroup,
  Row,
  RowList,
  STRETCH,
  StatusChip,
  useToast,
  type SkillLink,
} from '@/components/pos'
import { HIT } from '@/components/pos/button-classes'
import { useSearchState } from '@/components/pos/searchState'
import { cn } from '@/lib/utils'
import {
  addMonths,
  compactMoney,
  dueLabel,
  intervalLabel,
  money,
  monthKey,
  monthLabelLong,
  monthYear,
  next12Months,
  type DueStatus,
} from '../schedule'
import { markDone, snoozeService, type ActionResult } from './actions'
import { AssetForm } from './AssetForm'
import { AssetDrawer, LogServiceDrawer, WarrantyDrawer, type LogPrefill } from './Drawers'
import { ScheduleDrawer } from './ScheduleDrawer'
import { WarrantyForm } from './WarrantyForm'

export type Fact = { label: string; value: string }

export type HomeData = {
  todayIso: string
  /** Insurance's annual property cover through the registry, or null when it is not installed. */
  propertyPremium: number | null
  assets: {
    id: string
    kind: string
    name: string
    subtitle: string
    valueCents: number
    annualCostCents: number
    valueAsOf: string | null
    acquiredOn: string | null
    notes: string
    facts: Fact[]
    entityRef: string | null
    skills: SkillLink[]
  }[]
  services: {
    id: string
    assetId: string
    assetName: string
    title: string
    intervalMonths: number
    lastDoneOn: string | null
    dueOn: string | null
    status: DueStatus
    snoozeUntil: string | null
    costEstimateCents: number
    vendorId: string | null
    vendorName: string | null
    notes: string
  }[]
  log: {
    id: string
    assetId: string
    what: string
    doneOn: string
    costCents: number | null
    vendorName: string | null
  }[]
  warranties: {
    id: string
    assetId: string | null
    name: string
    detail: string
    cover: string
    expiresOn: string | null
    documentUrl: string
    facts: Fact[]
  }[]
  vendors: {
    id: string
    name: string
    trade: string
    contact: string
    lastUsedOn: string | null
    lastCostCents: number | null
  }[]
  /** Every skill in the tree, id and name. From getSkillNames() on the page. */
  skills: [string, string][]
}

export type Service = HomeData['services'][number]

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'property', label: 'Property' },
  { value: 'vehicle', label: 'Vehicles' },
  { value: 'equipment', label: 'Equipment' },
]

const shortDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`)
  return `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`
}

/** The 6px and 8px dots: what the job's status looks like on the calendar. */
const DOT: Record<DueStatus, string> = {
  overdue: 'bg-red',
  due: 'bg-orange',
  soon: 'bg-gray',
  later: 'bg-gray',
  snoozed: 'bg-gray-4',
  unscheduled: 'bg-gray',
}

/** "{asset} · yearly · {vendor}", the line under every job. */
export function jobMeta(job: Service) {
  return [
    job.assetName,
    intervalLabel(job.intervalMonths),
    job.vendorName,
    job.status === 'snoozed' && job.snoozeUntil ? `snoozed until ${shortDate(job.snoozeUntil)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function Home({ data }: { data: HomeData }) {
  const { params, set: setParams } = useSearchState()
  const filter = params.get('kind') ?? 'all'
  const month = params.get('month') ?? monthKey(data.todayIso)
  const openAsset = data.assets.find((a) => a.id === params.get('asset')) ?? null
  const openWarranty = data.warranties.find((w) => w.id === params.get('warranty')) ?? null
  const logging = params.get('log') === '1'
  // The add and edit forms: 'new' or the row's id, and `for` an asset to start
  // on when the form was opened from that asset's drawer.
  const editAsset = params.get('edit-asset')
  const editService = params.get('edit-service')
  const editWarranty = params.get('edit-warranty')
  const forAsset = params.get('for')
  const logService = data.services.find((s) => s.id === params.get('service')) ?? null
  const logPrefill: LogPrefill = logService
    ? {
        assetId: logService.assetId,
        serviceId: logService.id,
        what: logService.title,
        vendorId: logService.vendorId,
        intervalMonths: logService.intervalMonths,
      }
    : { assetId: forAsset ?? undefined }
  const open = (next: Record<string, string | null>) => setParams(next, { push: true })

  const [, start] = useTransition()
  const toast = useToast()

  const run = (action: () => Promise<ActionResult>, ok?: string) =>
    start(async () => {
      const result = await action()
      if (!result.ok) toast(result.error)
      else if (ok) toast(ok)
    })

  // A job leaves the calendar and the attention rail the moment Mark done or
  // Snooze is pressed, same shape as Inbox.tsx's act(): optimistic, reverted
  // with a toast on failure.
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
  const services = data.services.filter((s) => !gone.includes(s.id))

  const done = (job: Service) =>
    flip(
      job.id,
      () => markDone(job.id, job.assetId, job.title),
      'Marked done. It moves to the service history and reschedules on its interval.',
    )

  const scheduled = services.filter((s) => s.dueOn !== null)
  const months = next12Months(
    scheduled.map((s) => ({ dueOn: s.dueOn!, costEstimateCents: s.costEstimateCents })),
    data.todayIso,
  )
  const yearCents = months.reduce((sum, m) => sum + m.costCents, 0)
  const yearEnd = monthKey(addMonths(`${monthKey(data.todayIso)}-01`, 11))
  const inYear = scheduled.filter((s) => monthKey(s.dueOn!) <= yearEnd)
  const byDue = (a: Service, b: Service) => (a.dueOn! < b.dueOn! ? -1 : 1)
  const jobsIn = (key: string) => scheduled.filter((s) => monthKey(s.dueOn!) === key).sort(byDue)
  const monthJobs = jobsIn(month)
  const monthCents = monthJobs.reduce((sum, s) => sum + s.costEstimateCents, 0)

  const attention = services
    .filter((s) => s.status === 'overdue' || s.status === 'due')
    .sort((a, b) => (a.status === b.status ? byDue(a, b) : a.status === 'overdue' ? -1 : 1))
  const dueCents = attention.reduce((sum, s) => sum + s.costEstimateCents, 0)
  const nextUp = scheduled.filter((s) => s.status !== 'snoozed').sort(byDue)[0]

  const shownAssets = data.assets.filter((a) => filter === 'all' || a.kind === filter)
  const valueCents = data.assets.reduce((sum, a) => sum + a.valueCents, 0)
  const upkeepCents = data.assets.reduce((sum, a) => sum + a.annualCostCents, 0)
  const property = data.assets.find((a) => a.kind === 'property') ?? null
  const count = (kind: string) => data.assets.filter((a) => a.kind === kind).length
  const kinds = [
    `${count('property')} ${count('property') === 1 ? 'property' : 'properties'}`,
    `${count('vehicle')} ${count('vehicle') === 1 ? 'vehicle' : 'vehicles'}`,
    `${count('equipment')} equipment`,
  ].join(' · ')

  /** The soonest job that is not snoozed: what the card's pill and footer read. */
  const soonestFor = (assetId: string) =>
    scheduled.filter((s) => s.assetId === assetId && s.status !== 'snoozed').sort(byDue)[0] ?? null

  const yearAhead = addMonths(data.todayIso, 12)
  const expiringSoon = (iso: string | null) => iso !== null && iso <= yearAhead

  const dot = attention.some((s) => s.status === 'overdue')
    ? 'bad'
    : attention.length > 0
      ? 'warn'
      : 'brand'

  return (
    <div className="space-y-[22px]">
      <PageHeader
        eyebrow={
          <>
            Home <span className="text-secondary-label">/</span> Assets
          </>
        }
        title="Home & Property"
        lede="The house, the vehicles and the equipment worth tracking: what each is worth, what it costs to keep, and what it needs next."
        status={
          <Eyebrow dot={dot} className="whitespace-nowrap">
            {attention.length === 0
              ? 'Nothing due this month'
              : `${attention.length} job${attention.length === 1 ? '' : 's'} due this month · ${money(dueCents)} estimated`}
          </Eyebrow>
        }
        actions={
          data.assets.length === 0 ? (
            <ActionButton variant="solid" size="xl" onClick={() => open({ 'edit-asset': 'new' })}>
              Add asset
            </ActionButton>
          ) : (
            <ActionButton variant="solid" size="xl" onClick={() => open({ log: '1' })}>
              Log service <span aria-hidden="true">&rarr;</span>
            </ActionButton>
          )
        }
      />

      <div className="flex flex-wrap items-start gap-x-[52px] gap-y-7">
        <div className="min-w-0 flex-[1_1_540px] space-y-7">
          <MetricStrip>
            <MetricTile size="sm" label="Assets tracked" value={data.assets.length} delta={kinds} />
            <MetricTile
              size="sm"
              label="Combined value"
              value={compactMoney(valueCents)}
              delta={`${property && valueCents > 0 ? `House at ${Math.round((property.valueCents / valueCents) * 100)}% · ` : ''}your own estimate`}
            />
            <MetricTile size="sm" label="Annual upkeep" value={compactMoney(upkeepCents)} delta="Your own figures" />
            <MetricTile size="sm" label="Next 12 months" value={compactMoney(yearCents)} delta={`${inYear.length} scheduled jobs`} />
          </MetricStrip>

          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <Eyebrow>Assets</Eyebrow>
              <div className="flex flex-wrap items-center gap-2">
                <PillGroup
                  label="Asset kinds"
                  value={filter}
                  options={FILTERS}
                  onChange={(next) => setParams({ kind: next === 'all' ? null : next, asset: null })}
                />
                <ActionButton size="pill" onClick={() => open({ 'edit-asset': 'new' })}>
                  Add asset
                </ActionButton>
              </div>
            </div>

            {data.assets.length === 0 ? (
              <EmptyState
                headline="No assets yet"
                className="mt-3.5"
                action={
                  <ActionButton variant="solid" onClick={() => open({ 'edit-asset': 'new' })}>
                    Add your first asset
                  </ActionButton>
                }
              >
                Add the house, a car or the equipment worth keeping up, then schedule what each one needs.
              </EmptyState>
            ) : shownAssets.length === 0 ? (
              <EmptyState headline="Nothing here" className="mt-3.5">
                Nothing of this kind is tracked yet.
              </EmptyState>
            ) : (
              <div className="mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] items-stretch gap-3">
                {shownAssets.map((asset) => {
                  const next = soonestFor(asset.id)
                  const state =
                    next?.status === 'overdue' ? 'overdue' : next?.status === 'due' ? 'due' : 'good'
                  return (
                    <Card
                      key={asset.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setParams({ asset: asset.id }, { push: true })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setParams({ asset: asset.id }, { push: true })
                        }
                      }}
                      className={cn(
                        'block w-full cursor-pointer px-[18px] text-left transition-colors duration-150 hover:bg-fill-3 active:scale-[.985]',
                        state !== 'good' && 'ring-1',
                        state === 'overdue' ? 'ring-red-text' : state === 'due' ? 'ring-orange-text' : '',
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-2.5">
                        <Eyebrow>{cap(asset.kind)}</Eyebrow>
                        <StatusChip tone={state === 'overdue' ? 'bad' : state === 'due' ? 'warn' : 'ok'}>
                          {state === 'overdue' ? 'Overdue' : state === 'due' ? 'Service due' : 'Good'}
                        </StatusChip>
                      </div>
                      <div className="mt-3 text-body text-label">
                        {asset.name}
                      </div>
                      <div className="mt-[5px] text-caption-1 text-secondary-label">{asset.subtitle}</div>
                      <div className="mt-4 flex flex-wrap gap-3.5">
                        <span className="min-w-0 flex-[1_1_90px]">
                          <Eyebrow className="block">Value</Eyebrow>
                          <span className="num mt-[5px] block text-callout text-label">{money(asset.valueCents)}</span>
                        </span>
                        <span className="min-w-0 flex-[1_1_90px]">
                          <Eyebrow className="block">Annual cost</Eyebrow>
                          <span className="num mt-[5px] block text-callout text-label">{money(asset.annualCostCents)}</span>
                        </span>
                      </div>
                      <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-2 border-t border-separator pt-3">
                        <span className="min-w-0 flex-[1_1_140px] text-footnote text-label">
                          {next ? next.title : 'Nothing scheduled'}
                        </span>
                        <span
                          className={cn(
                            'num shrink-0 text-caption-1',
                            state === 'good' ? 'text-secondary-label' : 'text-orange-text',
                          )}
                        >
                          {next ? monthLabelLong(monthKey(next.dueOn!)) : 'none'}
                        </span>
                      </div>
                    </Card>
                  )
                })}
              </div>
            )}
          </section>

          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <Eyebrow>Maintenance · next 12 months</Eyebrow>
              <div className="flex flex-wrap items-center gap-3">
                <span className="num text-caption-1 text-secondary-label">
                  {inYear.length} jobs · {money(yearCents)} estimated
                </span>
                {data.assets.length > 0 && (
                  <ActionButton size="pill" onClick={() => open({ 'edit-service': 'new' })}>
                    Schedule service
                  </ActionButton>
                )}
              </div>
            </div>

            <div className="mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,110px),1fr))] gap-2">
              {months.map((m) => {
                const selected = m.key === month
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setParams({ month: m.key })}
                    aria-pressed={selected}
                    className={cn(
                      // Opaque in both states, the ring alone marks the selection, as the
                      // Calendar day pills do: a tint put secondary-label under 4.5:1.
                      'block w-full rounded-card bg-grouped-2 p-3 text-left transition-colors duration-150 active:scale-[.985]',
                      selected ? 'ring-2 ring-inset ring-accent' : 'hover:bg-fill-3',
                    )}
                  >
                    <span className="flex items-baseline justify-between">
                      <span className={cn('label', selected ? 'text-label' : 'text-secondary-label')}>{m.label}</span>
                      <span
                        className={cn(
                          'num text-caption-1',
                          m.isCurrent ? 'text-orange-text' : selected ? 'text-label' : 'text-secondary-label',
                        )}
                      >
                        {m.count}
                      </span>
                    </span>
                    <span className="mt-2.5 flex min-h-1.5 flex-wrap gap-[3px]">
                      {jobsIn(m.key)
                        .slice(0, 4)
                        .map((j) => (
                          <span key={j.id} className={cn('block size-1.5 rounded-full', DOT[j.status])} />
                        ))}
                    </span>
                    <span className="mt-2.5 block text-caption-1 text-secondary-label">
                      {m.costCents > 0 ? money(m.costCents) : 'No cost'}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="mt-[18px]">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <Eyebrow>{monthLabelLong(month)}</Eyebrow>
                <span className="num text-caption-1 text-secondary-label">
                  {monthCents > 0 ? `${money(monthCents)} estimated` : 'No cost'}
                </span>
              </div>

              {monthJobs.length === 0 ? (
                <EmptyState headline="Nothing scheduled" className="mt-3 px-[18px] py-[26px]">
                  No recurring service falls in this month.
                </EmptyState>
              ) : (
                <RowList className="mt-3">
                  {monthJobs.map((job) => (
                    <Row
                      key={job.id}
                      // The title is the button and its overlay covers the row, so
                      // Log and Mark done sit beside it rather than nested inside.
                      className="cursor-pointer hover:bg-fill-4 active:bg-fill-3"
                      title={
                        <button
                          type="button"
                          onClick={() => open({ 'edit-service': job.id })}
                          className={cn(STRETCH, 'flex items-center gap-2 text-left')}
                        >
                          <span className={cn('size-2 shrink-0 rounded-full', DOT[job.status])} />
                          {job.title}
                        </button>
                      }
                      meta={jobMeta(job)}
                      amount={job.costEstimateCents > 0 ? money(job.costEstimateCents) : 'no estimate'}
                      right={
                        <>
                          <ActionButton size="sm" className="relative" onClick={() => open({ log: '1', service: job.id })}>
                            Log
                          </ActionButton>
                          <ActionButton size="sm" className="relative" onClick={() => done(job)}>
                            Mark done
                          </ActionButton>
                        </>
                      }
                    />
                  ))}
                </RowList>
              )}
            </div>
          </section>

          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <Eyebrow>Warranties & documents</Eyebrow>
              <div className="flex flex-wrap items-center gap-3">
                <span className="num text-caption-1 text-secondary-label">
                  {data.warranties.filter((w) => expiringSoon(w.expiresOn)).length} expiring within a year
                </span>
                <ActionButton size="pill" onClick={() => open({ 'edit-warranty': 'new' })}>
                  Add warranty
                </ActionButton>
              </div>
            </div>
            {data.warranties.length === 0 && (
              <p className="mt-3 text-footnote text-secondary-label">
                No warranties or documents yet. One with an end date shows on the Calendar when it runs out.
              </p>
            )}
            <RowList className="mt-3">
              {data.warranties.map((w) => (
                <Row
                  key={w.id}
                  title={w.name}
                  meta={w.detail}
                  onClick={() => setParams({ warranty: w.id }, { push: true })}
                  right={
                    <>
                      <Chip tone="quiet">{w.cover}</Chip>
                      {/* No expiry is a real state for a deed, not a missing date. */}
                      <span className={cn('num text-footnote', expiringSoon(w.expiresOn) ? 'text-orange-text' : 'text-secondary-label')}>
                        {w.expiresOn ? monthLabelLong(monthKey(w.expiresOn)) : 'No expiry'}
                      </span>
                      <Chip tone={w.documentUrl ? 'neutral' : 'quiet'}>{w.documentUrl ? 'PDF' : 'No file'}</Chip>
                    </>
                  }
                />
              ))}
            </RowList>
          </section>
        </div>

        <div className="min-w-0 flex-[1_1_320px] space-y-[26px] xl:max-w-[352px]">
          <section>
            <Eyebrow>Needs attention</Eyebrow>
            {attention.length === 0 ? (
              <p className="mt-3 text-footnote text-secondary-label">
                Nothing outstanding. The next scheduled job is{' '}
                {nextUp ? `${nextUp.title} in ${monthLabelLong(monthKey(nextUp.dueOn!))}` : 'not scheduled'}.
              </p>
            ) : (
              <>
                {attention.slice(0, 4).map((job) => (
                  <Card
                    key={job.id}
                    className={cn('mt-2.5 px-3.5 py-3.5', job.status === 'overdue' && 'ring-1 ring-red-text')}
                  >
                    <div className="flex items-baseline justify-between gap-2.5">
                      <StatusChip tone={job.status === 'overdue' ? 'bad' : 'warn'}>
                        {job.status === 'overdue' ? 'Overdue' : 'Due now'}
                      </StatusChip>
                      <span className="text-footnote text-secondary-label">{dueLabel(job, data.todayIso)}</span>
                    </div>
                    <div className="mt-[7px] text-body text-label">{job.title}</div>
                    <div className="mt-1 text-caption-1 text-secondary-label">{jobMeta(job)}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <ActionButton size="sm" variant="accent" onClick={() => done(job)}>
                        Mark done
                      </ActionButton>
                      <ActionButton
                        size="sm"
                        onClick={() =>
                          flip(
                            job.id,
                            () => snoozeService(job.id, 30),
                            'Snoozed 30 days. It comes back, it does not go away.',
                          )
                        }
                      >
                        Snooze 30d
                      </ActionButton>
                    </div>
                  </Card>
                ))}
                {attention.length > 4 && (
                  <p className="mt-2.5 text-caption-1 text-secondary-label">+{attention.length - 4} more on the calendar</p>
                )}
              </>
            )}
          </section>

          {property && (
            <section>
              <Eyebrow>Property</Eyebrow>
              <RowList className="mt-3">
                {property.facts.map((f) => (
                  <Row key={f.label} title={f.label} amount={f.value} />
                ))}
                {data.propertyPremium !== null && (
                  <Row title="Insurance" amount={`${money(data.propertyPremium * 100)} / yr`} />
                )}
              </RowList>
              <p className="mt-3 text-caption-1 text-secondary-label">
                {data.propertyPremium === null ? (
                  'Coverage lives in Insurance, which is not installed.'
                ) : (
                  <>
                    Coverage comes from{' '}
                    <Link href="/insurance" className={cn(HIT, 'inline-block border-b border-opaque-separator text-label hover:border-label')}>
                      Insurance
                    </Link>
                    .
                  </>
                )}
              </p>
            </section>
          )}

          <section>
            <Eyebrow>Vendors</Eyebrow>
            <RowList className="mt-3">
              {data.vendors.map((v) => (
                <Row
                  key={v.id}
                  title={v.name}
                  meta={[
                    v.contact,
                    v.lastUsedOn
                      ? `Last used ${monthYear(v.lastUsedOn)}${v.lastCostCents !== null ? ` · ${money(v.lastCostCents)}` : ''}`
                      : 'Not used yet',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  right={<Chip tone="quiet">{v.trade}</Chip>}
                />
              ))}
            </RowList>
          </section>
        </div>
      </div>

      <AssetDrawer
        asset={openAsset}
        log={openAsset ? data.log.filter((l) => l.assetId === openAsset.id) : []}
        skills={data.skills}
        onClose={() => setParams({ asset: null })}
        onEdit={() => open({ asset: null, 'edit-asset': openAsset!.id })}
        onSchedule={() => open({ asset: null, 'edit-service': 'new', for: openAsset!.id })}
        onLog={() => open({ asset: null, log: '1', for: openAsset!.id })}
      />
      <WarrantyDrawer
        warranty={openWarranty}
        onClose={() => setParams({ warranty: null })}
        onEdit={() => open({ warranty: null, 'edit-warranty': openWarranty!.id })}
      />
      <LogServiceDrawer
        key={logService?.id ?? forAsset ?? 'log'}
        open={logging}
        data={data}
        prefill={logPrefill}
        onClose={() => setParams({ log: null, service: null, for: null })}
        run={run}
      />
      {/* An id that matches nothing (Back after Archive) opens nothing, not a New
          form whose save would make a duplicate. */}
      {(editAsset === 'new' || data.assets.some((a) => a.id === editAsset)) && (
        <AssetForm
          asset={data.assets.find((a) => a.id === editAsset) ?? null}
          todayIso={data.todayIso}
          onClose={() => setParams({ 'edit-asset': null })}
        />
      )}
      {(editService === 'new' ? data.assets.length > 0 : data.services.some((s) => s.id === editService)) && (
        <ScheduleDrawer
          service={data.services.find((s) => s.id === editService) ?? null}
          assetId={forAsset}
          data={data}
          onClose={() => setParams({ 'edit-service': null, for: null })}
        />
      )}
      {(editWarranty === 'new' || data.warranties.some((w) => w.id === editWarranty)) && (
        <WarrantyForm
          warranty={data.warranties.find((w) => w.id === editWarranty) ?? null}
          data={data}
          onClose={() => setParams({ 'edit-warranty': null })}
        />
      )}
    </div>
  )
}

