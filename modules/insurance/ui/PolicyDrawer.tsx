'use client'

import { useId, useRef, useState, useTransition } from 'react'
import {
  ActionButton,
  Card,
  ConfirmButton,
  Eyebrow,
  Field,
  Overlay,
  PillGroup,
  SkillPicker,
  StatusChip,
  Switch,
  fieldClass,
  useFormErrors,
  useToast,
  type SkillLink,
} from '@/components/pos'
import { parseNumber } from '@/core/numbers'
import { cn } from '@/lib/utils'
import {
  CADENCE_LABELS,
  annualCents,
  cap,
  daysLabel,
  daysUntil,
  inFinance,
  leadsLabel,
  money,
  nextTermEnd,
  paymentSchedule,
  policyStatus,
  reminderMarks,
  shortDate,
  type Cadence,
  type PolicyStatus,
} from '../premium'
import { attachDocument, deletePolicy, documentUrl, renewPolicy, reveal, savePolicy, type ActionResult } from './actions'

const KINDS = [
  'auto', 'renters', 'homeowners', 'health', 'dental', 'vision', 'life', 'pet',
  'device', 'umbrella', 'other',
] as const

const CADENCES: Cadence[] = ['monthly', 'quarterly', 'semiannual', 'annual']

const LEADS = [60, 30, 14, 7, 0]

const CHANNEL_NAMES: Record<string, string> = { push: 'push', email: 'email', inapp: 'in-app' }

export type Policy = {
  id: string
  kind: string
  name: string
  carrier: string
  maskedNumber: string
  expiresOn: string | null
  premiumCents: number
  cadence: Cadence
  deductibleCents: number | null
  limits: string
  agentName: string
  agentContact: string
  reminderLeads: number[]
  postToFinance: boolean
  status: string
  notes: string
  documentCount: number
  entityRef: string | null
  skills: SkillLink[]
}

export type InsuranceData = {
  todayIso: string
  policies: Policy[]
  documents: { id: string; policyId: string; name: string; meta: string; hasFile: boolean }[]
  /** The policy renewal rule's channels, or null when it is muted. */
  renewalChannels: string[] | null
  /** Every skill in the tree, id and name. From getSkillNames() on the page. */
  skills: [string, string][]
}

/** The expiry colour: red inside thirty days or past, amber inside sixty, green otherwise. */
export const EXPIRY_TEXT: Record<PolicyStatus, string> = {
  expired: 'text-red-text',
  'renew-now': 'text-red-text',
  expiring: 'text-orange-text',
  active: 'text-green-text',
  undated: 'text-secondary-label',
}

const EXPIRY_TONE = {
  expired: 'bad',
  'renew-now': 'bad',
  expiring: 'warn',
  active: 'ok',
  undated: 'quiet',
} as const

const PILL: Record<PolicyStatus, string> = {
  expired: 'Expired',
  'renew-now': 'Renew now',
  expiring: 'Expiring',
  active: 'Active',
  undated: 'No date',
}

/** The state chip the table and the drawer share. */
export function StatusPill({ policy, todayIso, className }: { policy: Policy; todayIso: string; className?: string }) {
  const status = policyStatus(policy.expiresOn, todayIso)
  const closed = policy.status !== 'active'
  return (
    <StatusChip tone={closed ? 'quiet' : EXPIRY_TONE[status]} className={className}>
      {closed ? cap(policy.status) : PILL[status]}
    </StatusChip>
  )
}

type Run = (action: () => Promise<ActionResult>, ok?: string, then?: () => void) => void

export function PolicyDrawer({
  policy,
  editing,
  data,
  run,
  onClose,
  onEdit,
  onCancelEdit,
}: {
  /** Null for a new policy. */
  policy: Policy | null
  editing: boolean
  data: InsuranceData
  run: Run
  onClose: () => void
  onEdit: () => void
  onCancelEdit: () => void
}) {
  if (editing || !policy) {
    return <PolicyForm policy={policy} channels={data.renewalChannels} run={run} onClose={onClose} onCancel={onCancelEdit} />
  }
  return <PolicyView policy={policy} data={data} run={run} onClose={onClose} onEdit={onEdit} />
}

function PolicyView({
  policy,
  data,
  run,
  onClose,
  onEdit,
}: {
  policy: Policy
  data: InsuranceData
  run: Run
  onClose: () => void
  onEdit: () => void
}) {
  const [, start] = useTransition()
  const toast = useToast()
  /** The one policy number the owner asked to see, held only in this state. */
  const [revealed, setRevealed] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const status = policyStatus(policy.expiresOn, data.todayIso)
  const days = daysUntil(policy.expiresOn, data.todayIso)
  const docs = data.documents.filter((d) => d.policyId === policy.id)
  const renewTo = policy.expiresOn ? nextTermEnd(policy.expiresOn, policy.cadence) : null

  return (
    <Overlay
      open
      onClose={onClose}
      eyebrow={`Insurance / ${policy.name}`}
      title={
        <>
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <Eyebrow className="block">{cap(policy.kind)}</Eyebrow>
              <span className="mt-1.5 block text-title-2">{policy.name}</span>
              <span className="mt-1.5 block text-footnote font-normal tracking-normal text-secondary-label">{policy.carrier}</span>
            </span>
            <StatusPill policy={policy} todayIso={data.todayIso} className="mt-1 shrink-0" />
          </span>
          <button
            type="button"
            onClick={() =>
              start(async () => {
                if (revealed !== null) {
                  setRevealed(null)
                  return
                }
                const result = await reveal(policy.id)
                if (!result.ok) toast(result.error)
                else setRevealed(result.number)
              })
            }
            className="num mt-2.5 inline-flex min-h-11 items-center gap-2.5 rounded-control bg-fill-3 px-3 py-1.5 text-footnote font-normal tracking-[0.04em] text-label transition-colors duration-150 hover:bg-fill-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring)"
          >
            {revealed ?? policy.maskedNumber}
            <span className="text-footnote font-medium text-label/70">{revealed !== null ? 'Hide' : 'Reveal'}</span>
          </button>
        </>
      }
      footer={
        <>
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={onEdit}>
              Edit
            </ActionButton>
            {renewTo && (
              <ActionButton
                variant="primary"
                onClick={() =>
                  run(
                    () => renewPolicy(policy.id, renewTo),
                    `Renewed to ${renewTo}. Same row, so the history stays together.`,
                  )
                }
              >
                Mark renewed · {shortDate(renewTo)}
              </ActionButton>
            )}
          </div>
          <ConfirmButton
            confirmLabel="Delete"
            title="Delete this policy?"
            message={`${policy.name} and its documents are deleted.`}
            onConfirm={() => run(() => deletePolicy(policy.id), 'Policy deleted', onClose)}
          >
            Delete
          </ConfirmButton>
        </>
      }
    >
      <div className="flex flex-col gap-[18px]">
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-card bg-separator">
          <Cell label="Expires" value={daysLabel(policy.expiresOn, data.todayIso)} tone={EXPIRY_TEXT[status]}>
            {policy.expiresOn ? shortDate(policy.expiresOn, data.todayIso) : 'not on file'}
          </Cell>
          <Cell label="Premium" value={money(policy.premiumCents)}>
            {CADENCE_LABELS[policy.cadence]} · {money(annualCents(policy.premiumCents, policy.cadence))}/yr
          </Cell>
          <Cell
            label="Deductible"
            // Null is "not on this policy", which term life genuinely is not.
            // Zero would claim the deductible is nothing.
            value={policy.deductibleCents === null ? 'none' : money(policy.deductibleCents)}
          >
            {policy.limits || 'nothing written down'}
          </Cell>
        </div>

        {policy.expiresOn && (
          <Card>
            <div className="flex items-baseline justify-between gap-3">
              <Eyebrow>Payment schedule</Eyebrow>
              <StatusChip tone={inFinance(policy, data.todayIso) ? 'brand' : 'quiet'}>
                {inFinance(policy, data.todayIso) ? 'In Finance' : 'Not in Finance'}
              </StatusChip>
            </div>
            <div className="mt-1.5 flex flex-col">
              {paymentSchedule(policy.expiresOn, policy.cadence, data.todayIso).map((p, i) => {
                const tone = p.label === 'Last' ? 'text-secondary-label' : p.label === 'Next' ? 'font-medium text-label' : 'text-label'
                return (
                  <div key={i} className={cn('flex justify-between border-b border-separator py-[7px] text-footnote', tone)}>
                    <span>{p.label}</span>
                    <span className="num">
                      {shortDate(p.on, data.todayIso)} · {money(policy.premiumCents)}
                    </span>
                  </div>
                )
              })}
            </div>
          </Card>
        )}

        <Card>
          <div className="flex items-baseline justify-between gap-3">
            <Eyebrow>Renewal reminders</Eyebrow>
            <span className="text-caption-1 text-secondary-label">{leadsLabel(policy.reminderLeads)}</span>
          </div>
          {days !== null && (
            <>
              <div className="relative mt-2 h-6">
                <div className="absolute inset-x-0 top-[11px] h-px bg-opaque-separator" />
                {reminderMarks(policy.reminderLeads, days).map((m) => (
                  <span
                    key={m.lead}
                    title={m.lead === 0 ? 'Day of' : `${m.lead} days before`}
                    style={{ left: `calc(${m.at}% - 4px)` }}
                    className={cn(
                      'absolute top-[7px] size-[9px] rotate-45 border border-accent rounded-full',
                      m.fired ? 'bg-accent' : 'bg-grouped-2',
                    )}
                  />
                ))}
                <span className="absolute left-0 top-1 h-[15px] w-px bg-label" />
              </div>
              <div className="flex justify-between text-caption-1 text-secondary-label">
                <span>Today</span>
                <span>{shortDate(policy.expiresOn!, data.todayIso)}</span>
              </div>
            </>
          )}
        </Card>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <Eyebrow>Documents</Eyebrow>
            <ActionButton size="sm" onClick={() => fileInput.current?.click()}>
              + Attach PDF
            </ActionButton>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf"
              aria-label="Attach PDF"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const form = new FormData()
                form.set('policyId', policy.id)
                form.set('file', file)
                run(() => attachDocument(form), 'Attached')
                e.target.value = ''
              }}
            />
          </div>
          <div className="mt-1.5 flex flex-col">
            {docs.length === 0 && <span className="py-1.5 text-footnote text-secondary-label">No documents yet</span>}
            {docs.map((d) => {
              const inner = (
                <>
                  <span className="min-w-0 truncate">{d.name}</span>
                  <span className="num shrink-0 text-caption-1 text-secondary-label">{d.meta}</span>
                </>
              )
              const row = 'flex min-h-11 items-center justify-between gap-2.5 border-b border-separator py-2 text-footnote'
              return d.hasFile ? (
                <button
                  key={d.id}
                  type="button"
                  className={cn(row, '-mx-1.5 w-[calc(100%+12px)] rounded-control px-1.5 text-left transition-colors duration-150 hover:bg-fill-3')}
                  onClick={() =>
                    start(async () => {
                      const result = await documentUrl(d.id)
                      if (!result.ok) toast(result.error)
                      else window.open(result.url, '_blank', 'noopener')
                    })
                  }
                >
                  {inner}
                </button>
              ) : (
                <div key={d.id} className={row}>
                  {inner}
                </div>
              )
            })}
          </div>
        </div>

        <Card>
          <Eyebrow>Agent</Eyebrow>
          {policy.agentName || policy.agentContact ? (
            <>
              <div className="mt-1.5 text-subheadline text-label">{policy.agentName || policy.agentContact}</div>
              {policy.agentName && policy.agentContact && (
                <div className="num mt-0.5 text-caption-1 text-secondary-label">{policy.agentContact}</div>
              )}
            </>
          ) : (
            <div className="mt-1.5 text-footnote text-secondary-label">No agent on file</div>
          )}
        </Card>

        <Card>
          <Eyebrow>Linked skills</Eyebrow>
          {policy.entityRef ? (
            <SkillPicker entityRef={policy.entityRef} links={policy.skills} skills={data.skills} className="mt-2" />
          ) : (
            <p className="mt-2 text-footnote text-secondary-label">Nothing matched yet.</p>
          )}
        </Card>
      </div>
    </Overlay>
  )
}

function Cell({
  label,
  value,
  tone,
  children,
}: {
  label: string
  value: string
  tone?: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0 bg-grouped-2 px-3 py-2.5">
      <Eyebrow>{label}</Eyebrow>
      <span className={cn('num mt-1.5 block text-title-3 font-semibold text-label', tone)}>{value}</span>
      <span className="mt-0.5 block text-caption-1 text-secondary-label">{children}</span>
    </div>
  )
}

function PolicyForm({
  policy,
  channels,
  run,
  onClose,
  onCancel,
}: {
  policy: Policy | null
  channels: string[] | null
  run: Run
  onClose: () => void
  onCancel: () => void
}) {
  const initial = {
    kind: policy?.kind ?? 'auto',
    name: policy?.name ?? '',
    carrier: policy?.carrier ?? '',
    policyNumber: '',
    expiresOn: policy?.expiresOn ?? '',
    premium: policy ? String(policy.premiumCents / 100) : '',
    cadence: policy?.cadence ?? 'monthly',
    deductible: policy === null || policy.deductibleCents === null ? '' : String(policy.deductibleCents / 100),
    limits: policy?.limits ?? '',
    agentName: policy?.agentName ?? '',
    agentContact: policy?.agentContact ?? '',
    leads: policy?.reminderLeads ?? [60, 30, 7],
    postToFinance: policy?.postToFinance ?? false,
  }
  const [form, setForm] = useState(initial)
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => String(form[k]) !== String(initial[k]))

  const set = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }))
  const dollars = (value: string) => {
    const n = Number(value.replace(/[^0-9.]/g, ''))
    return value.trim() === '' || !Number.isFinite(n) ? null : Math.round(n * 100)
  }
  const formId = useId()
  const { errors, ref: formRef, submit } = useFormErrors(() => ({
    name: form.name.trim() ? undefined : 'Policy name is required',
    premium: form.premium.trim() && parseNumber(form.premium) === null ? 'Premium must be a number' : undefined,
    deductible: form.deductible.trim() && parseNumber(form.deductible) === null ? 'Deductible must be a number' : undefined,
  }))

  const save = () => {
    if (!submit()) return
    run(
      () =>
        savePolicy({
          id: policy?.id,
          kind: form.kind,
          name: form.name,
          carrier: form.carrier,
          policyNumber: form.policyNumber || undefined,
          expiresOn: form.expiresOn || null,
          premiumCents: dollars(form.premium) ?? 0,
          cadence: form.cadence,
          deductibleCents: dollars(form.deductible),
          limits: form.limits,
          agentName: form.agentName,
          agentContact: form.agentContact,
          reminderLeads: form.leads,
          postToFinance: form.postToFinance,
        }),
      policy ? 'Saved' : 'Policy created',
      policy ? onCancel : onClose,
    )
  }

  return (
    <Overlay
      open
      onClose={onClose}
      dirty={dirty}
      eyebrow={policy ? 'Insurance / Edit' : 'Insurance / New policy'}
      footer={
        <>
          <ActionButton variant="quiet" onClick={onCancel}>
            Cancel
          </ActionButton>
          <ActionButton variant="solid" size="xl" type="submit" form={formId}>
            {policy ? 'Save' : 'Create'} <span aria-hidden="true">&rarr;</span>
          </ActionButton>
        </>
      }
    >
      <form
        id={formId}
        ref={formRef}
        className="flex flex-col gap-[18px]"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Policy name" required error={errors.name} className="col-span-2">
            <input
              aria-label="Policy name"
              value={form.name}
              placeholder="e.g. 2019 Civic · full coverage"
              onChange={(e) => set({ name: e.target.value })}
              className={fieldClass}
            />
          </Field>
          <Labelled label="Type">
            <select aria-label="Type" value={form.kind} onChange={(e) => set({ kind: e.target.value })} className={fieldClass}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {cap(k)}
                </option>
              ))}
            </select>
          </Labelled>
          <Labelled label="Carrier">
            <input aria-label="Carrier" value={form.carrier} onChange={(e) => set({ carrier: e.target.value })} className={fieldClass} />
          </Labelled>
          <Labelled label="Policy number">
            <input
              aria-label="Policy number"
              value={form.policyNumber}
              placeholder={policy ? 'Leave blank to keep the one on file' : ''}
              onChange={(e) => set({ policyNumber: e.target.value })}
              className={cn(fieldClass, 'num')}
            />
          </Labelled>
          <Labelled label="Expires">
            <input
              type="date"
              aria-label="Expires"
              value={form.expiresOn}
              onChange={(e) => set({ expiresOn: e.target.value })}
              className={cn(fieldClass, 'num')}
            />
          </Labelled>
          <Field label="Premium" error={errors.premium}>
            <input
              inputMode="decimal"
              aria-label="Premium"
              value={form.premium}
              placeholder="$"
              onChange={(e) => set({ premium: e.target.value })}
              className={cn(fieldClass, 'num')}
            />
          </Field>
          <Labelled label="Billed">
            <select
              aria-label="Billed"
              value={form.cadence}
              onChange={(e) => set({ cadence: e.target.value as Cadence })}
              className={fieldClass}
            >
              {CADENCES.map((c) => (
                <option key={c} value={c}>
                  {CADENCE_LABELS[c]}
                </option>
              ))}
            </select>
          </Labelled>
          <Field label="Deductible" error={errors.deductible}>
            <input
              inputMode="decimal"
              aria-label="Deductible"
              value={form.deductible}
              placeholder="$"
              onChange={(e) => set({ deductible: e.target.value })}
              className={cn(fieldClass, 'num')}
            />
          </Field>
          <Labelled label="Coverage limits">
            <input
              aria-label="Coverage limits"
              value={form.limits}
              placeholder="100/300/100"
              onChange={(e) => set({ limits: e.target.value })}
              className={cn(fieldClass, 'num')}
            />
          </Labelled>
          <Labelled label="Agent · contact" className="col-span-2">
            <div className="grid grid-cols-2 gap-3">
              <input aria-label="Agent" value={form.agentName} placeholder="Name" onChange={(e) => set({ agentName: e.target.value })} className={fieldClass} />
              <input aria-label="Agent contact" value={form.agentContact} placeholder="Phone · email" onChange={(e) => set({ agentContact: e.target.value })} className={fieldClass} />
            </div>
          </Labelled>
        </div>

        <Card className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2.5">
            <div>
              <div className="text-subheadline text-label">Renewal reminders</div>
              <div className="text-caption-1 text-secondary-label">
                {channels
                  ? `${cap(channels.map((c) => CHANNEL_NAMES[c] ?? c).join(' + '))}, per your Settings › Notifications`
                  : 'Reminders are off in Notifications.'}
              </div>
            </div>
            <PillGroup
              multiple
              label="Leads"
              options={LEADS.map((l) => ({ value: String(l), label: l === 0 ? 'Day of' : `${l}d` }))}
              value={form.leads.map(String)}
              onChange={(v) => {
                const l = Number(v)
                set({ leads: form.leads.includes(l) ? form.leads.filter((x) => x !== l) : [...form.leads, l] })
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-2.5 border-t border-separator pt-2.5">
            <div>
              <div className="text-subheadline text-label">Post premium to Finance</div>
              <div className="text-caption-1 text-secondary-label">Shows in Finance as a recurring charge. Needs an expiry date.</div>
            </div>
            <Switch
              label="Post premium to Finance"
              checked={form.postToFinance}
              onChange={(postToFinance) => set({ postToFinance })}
            />
          </div>
        </Card>
      </form>
    </Overlay>
  )
}

function Labelled({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Eyebrow>{label}</Eyebrow>
      {children}
    </div>
  )
}
