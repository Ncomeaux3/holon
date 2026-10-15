'use client'

import { useTransition } from 'react'
import {
  ActionButton,
  DataRow,
  DataTable,
  EmptyState,
  Eyebrow,
  MetricStrip,
  MetricTile,
  PageHeader,
  useToast,
} from '@/components/pos'
import { useSearchState } from '@/components/pos/searchState'
import { cn } from '@/lib/utils'
import {
  annualCents,
  cadenceTag,
  cap,
  daysLabel,
  daysUntil,
  inFinance,
  leadsLabel,
  money,
  policyStatus,
  shortDate,
} from '../premium'
import type { ActionResult } from './actions'
import { EXPIRY_TEXT, PolicyDrawer, StatusPill, type InsuranceData, type Policy } from './PolicyDrawer'
import { UploadDrawer } from './UploadDrawer'

export type { InsuranceData, Policy }

export function Insurance({ data }: { data: InsuranceData }) {
  const { params, set: setParams } = useSearchState()
  const open = data.policies.find((p) => p.id === params.get('policy')) ?? null
  const editing = params.get('edit') === '1'
  const creating = params.get('policy') === 'new' && editing
  const uploading = params.get('upload') === '1'

  const [, start] = useTransition()
  const toast = useToast()

  const run = (action: () => Promise<ActionResult>, ok?: string, then?: () => void) =>
    start(async () => {
      const result = await action()
      if (!result.ok) toast(result.error)
      else {
        if (ok) toast(ok)
        then?.()
      }
    })

  const active = data.policies.filter((p) => p.status === 'active')
  const annual = active.reduce((sum, p) => sum + annualCents(p.premiumCents, p.cadence), 0)
  const soon = active.filter((p) => {
    const status = policyStatus(p.expiresOn, data.todayIso)
    return status === 'expiring' || status === 'renew-now' || status === 'expired'
  })
  const urgent = soon.some((p) => daysUntil(p.expiresOn, data.todayIso)! <= 30)
  const next = active
    .filter((p) => p.expiresOn !== null && daysUntil(p.expiresOn, data.todayIso)! >= 0)
    .sort((a, b) => (a.expiresOn! < b.expiresOn! ? -1 : 1))[0]
  const linked = active.filter((p) => inFinance(p, data.todayIso)).length

  const sub = 'mt-1 block text-caption-2 font-normal tracking-normal text-secondary-label'

  return (
    <div className="space-y-[18px]">
      <PageHeader
        eyebrow={
          <>
            Insurance <span className="text-secondary-label">/</span> Policies
          </>
        }
        title="Insurance"
        lede="Sorted by what expires first. Reminders fire 60, 30 and 7 days out by default."
        status={
          <Eyebrow dot={urgent ? 'bad' : soon.length > 0 ? 'warn' : 'ok'} className="whitespace-nowrap">
            {active.length} policies · {soon.length} expiring soon
          </Eyebrow>
        }
        // Two actions on the phone row squeezed the h1 to "Insuran…": the
        // phone gets the pair at pill size with the shorter word, same names.
        phoneAction={
          <>
            <ActionButton size="pill" aria-label="Upload PDF" onClick={() => setParams({ upload: '1' }, { push: true })}>
              Upload
            </ActionButton>
            <ActionButton size="pill" variant="solid" onClick={() => setParams({ policy: 'new', edit: '1' }, { push: true })}>
              Add policy
            </ActionButton>
          </>
        }
        actions={
          <>
            <ActionButton onClick={() => setParams({ upload: '1' }, { push: true })}>
              Upload PDF
            </ActionButton>
            <ActionButton
              variant="solid"
              size="xl"
              onClick={() => setParams({ policy: 'new', edit: '1' }, { push: true })}
            >
              Add policy <span aria-hidden="true">&rarr;</span>
            </ActionButton>
          </>
        }
      />

      <MetricStrip className="sm:grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))]">
        <MetricTile
          size="sm"
          className="px-[18px] py-3.5 sm:px-[18px] sm:py-3.5"
          label="Annual premium"
          value={
            <>
              {money(annual)}
              <span className={sub}>{active.length} active policies</span>
            </>
          }
        />
        <MetricTile
          size="sm"
          className="px-[18px] py-3.5 sm:px-[18px] sm:py-3.5"
          label="Per month"
          value={
            <>
              {money(Math.round(annual / 12))}
              <span className={sub}>{linked} in Finance</span>
            </>
          }
        />
        <MetricTile
          size="sm"
          className="px-[18px] py-3.5 sm:px-[18px] sm:py-3.5"
          label="Next renewal"
          value={
            <>
              {next ? (
                <>
                  {daysUntil(next.expiresOn, data.todayIso)}
                  <span className="text-footnote font-normal tracking-normal text-secondary-label"> days</span>
                </>
              ) : (
                'none'
              )}
              <span className={cn(sub, 'truncate')}>
                {next ? `${next.name} · ${shortDate(next.expiresOn!, data.todayIso)}` : 'nothing dated'}
              </span>
            </>
          }
        />
        <MetricTile
          size="sm"
          className="px-[18px] py-3.5 sm:px-[18px] sm:py-3.5"
          label="Expiring ≤ 60d"
          value={
            <>
              <span className={soon.length > 0 ? 'text-orange-text' : undefined}>{soon.length}</span>
              <span className={sub}>
                {soon.length > 0
                  ? soon.map((p) => p.name.split(/\s[·,]\s/)[0]).join(', ')
                  : 'Nothing due soon'}
              </span>
            </>
          }
        />
      </MetricStrip>

      <DataTable
        head={['Policy', 'Premium', 'Expires', 'Reminder', 'Status']}
        cols="minmax(0,2.2fr) minmax(0,1fr) minmax(0,1.3fr) minmax(0,1fr) 88px"
      >
        {data.policies.length === 0 ? (
          <EmptyState headline="No policies" className="mt-4">
            Add one by hand, or drop a declarations page and confirm what is read off it.
          </EmptyState>
        ) : (
          data.policies.map((policy) => {
            const status = policyStatus(policy.expiresOn, data.todayIso)
            return (
              <DataRow
                key={policy.id}
                selected={open?.id === policy.id}
                onClick={() => setParams({ policy: policy.id, edit: null }, { push: true })}
                // Below lg: the name and the status chip share the first line
                // and premium, expiry and reminder flow under them. DataRow's
                // own reflow gave a five-cell row no room for the premium.
                className="max-lg:flex max-lg:flex-wrap max-lg:items-center max-lg:gap-x-3 max-lg:gap-y-1.5"
              >
                <span className="flex min-w-0 items-center gap-3 max-lg:order-1 max-lg:shrink max-lg:grow max-lg:basis-[60%]">
                  <Eyebrow className="w-14 shrink-0">{cap(policy.kind)}</Eyebrow>
                  <span className="min-w-0">
                    <span
                      className={cn(
                        'line-clamp-2 text-subheadline',
                        policy.status === 'active' ? 'text-label' : 'text-secondary-label',
                      )}
                    >
                      {policy.name}
                    </span>
                    <span className="mt-0.5 block truncate text-caption-2 text-secondary-label">
                      {policy.carrier} · {policy.maskedNumber}
                    </span>
                  </span>
                </span>
                <span className="num whitespace-nowrap text-footnote text-label max-lg:order-3">
                  {money(policy.premiumCents)}
                  <span className="text-caption-2 text-secondary-label"> {cadenceTag(policy.cadence)}</span>
                </span>
                <span className="min-w-0 max-lg:order-4">
                  <span className={cn('num block whitespace-nowrap text-footnote', EXPIRY_TEXT[status])}>
                    {daysLabel(policy.expiresOn, data.todayIso)}
                  </span>
                  {policy.expiresOn && (
                    <span className="mt-0.5 block whitespace-nowrap text-caption-2 text-secondary-label">
                      {shortDate(policy.expiresOn, data.todayIso)}
                    </span>
                  )}
                </span>
                <span className="whitespace-nowrap text-caption-1 text-secondary-label max-lg:order-5">
                  {leadsLabel(policy.reminderLeads)}
                </span>
                <StatusPill policy={policy} todayIso={data.todayIso} className="w-[88px] justify-center max-lg:order-2" />
              </DataRow>
            )
          })
        )}
      </DataTable>

      {(open || creating) && (
        <PolicyDrawer
          key={open?.id ?? 'new'}
          policy={open}
          editing={editing}
          data={data}
          run={run}
          onClose={() => setParams({ policy: null, edit: null })}
          onEdit={() => setParams({ edit: '1' })}
          onCancelEdit={() => setParams(open ? { edit: null } : { policy: null, edit: null })}
        />
      )}

      <UploadDrawer open={uploading} onClose={() => setParams({ upload: null })} toast={toast} />
    </div>
  )
}
