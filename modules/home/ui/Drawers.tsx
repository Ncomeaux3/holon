'use client'

import { useId, useState } from 'react'
import {
  ActionButton,
  Eyebrow,
  Field,
  Overlay,
  PillGroup,
  Row,
  RowList,
  SkillPicker,
  fieldClass,
  submitOnModEnter,
  useFormErrors,
} from '@/components/pos'
import { HIT } from '@/components/pos/button-classes'
import { parseNumber } from '@/core/numbers'
import { cn } from '@/lib/utils'
import { addMonths, logDate, money, monthKey, monthLabelLong } from '../schedule'
import { logService, type ActionResult } from './actions'
import type { Fact, HomeData } from './Home'

// The three drawers: an asset, a warranty, the Log service form. The add and
// edit forms are their own files: AssetForm, ScheduleDrawer, WarrantyForm. The shared
// Overlay at `narrow` draws the band and the title; what is here is the rows.


function FactRows({ facts }: { facts: Fact[] }) {
  return (
    <div>
      {facts.map((f) => (
        <div
          key={f.label}
          className="flex flex-wrap items-baseline gap-x-3.5 gap-y-2 border-b border-separator py-[13px]"
        >
          <Eyebrow className="w-[126px] shrink-0">{f.label}</Eyebrow>
          <span className="min-w-0 flex-[1_1_160px] text-body text-label">{f.value}</span>
        </div>
      ))}
    </div>
  )
}

const closeFooter = (onClose: () => void) => (
  <ActionButton variant="accent" onClick={onClose}>
    Close
  </ActionButton>
)

export function AssetDrawer({
  asset,
  log,
  skills,
  onClose,
  onEdit,
  onSchedule,
  onLog,
}: {
  asset: HomeData['assets'][number] | null
  log: HomeData['log']
  skills: [string, string][]
  onClose: () => void
  onEdit: () => void
  onSchedule: () => void
  onLog: () => void
}) {
  return (
    <Overlay
      open={asset !== null}
      onClose={onClose}
      narrow
      eyebrow={asset?.kind}
      title={asset?.name ?? ''}
      lede={asset?.subtitle}
      footer={
        <>
          <ActionButton variant="outline" size="md" onClick={onEdit}>
            Edit
          </ActionButton>
          <ActionButton variant="outline" size="md" onClick={onSchedule}>
            Schedule
          </ActionButton>
          <ActionButton variant="solid" onClick={onLog}>
            Log service
          </ActionButton>
        </>
      }
    >
      {asset && (
        <div className="space-y-[22px]">
          <FactRows facts={asset.facts} />
          {log.length > 0 && (
            <div>
              <Eyebrow>Service history</Eyebrow>
              <RowList className="mt-2">
                {log.map((l) => (
                  <Row
                    key={l.id}
                    title={`${l.what}${l.vendorName ? ` · ${l.vendorName}` : ''}`}
                    date={logDate(l.doneOn)}
                    // Null is "no receipt to hand", which is not the same claim as free.
                    amount={l.costCents === null ? 'not recorded' : money(l.costCents)}
                  />
                ))}
              </RowList>
            </div>
          )}
          <div>
            <Eyebrow>Linked skills</Eyebrow>
            {asset.entityRef ? (
              <SkillPicker entityRef={asset.entityRef} links={asset.skills} skills={skills} className="mt-2" />
            ) : (
              <p className="mt-2 text-footnote text-secondary-label">Nothing matched yet.</p>
            )}
          </div>
        </div>
      )}
    </Overlay>
  )
}

export function WarrantyDrawer({
  warranty,
  onClose,
  onEdit,
}: {
  warranty: HomeData['warranties'][number] | null
  onClose: () => void
  onEdit: () => void
}) {
  return (
    <Overlay
      open={warranty !== null}
      onClose={onClose}
      narrow
      eyebrow="Warranty"
      title={warranty?.name ?? ''}
      lede={warranty?.detail}
      footer={
        <>
          <ActionButton variant="outline" size="md" onClick={onEdit}>
            Edit
          </ActionButton>
          {closeFooter(onClose)}
        </>
      }
    >
      {warranty && (
        <div className="space-y-[22px]">
          <FactRows facts={warranty.facts} />
          {warranty.documentUrl && (
            <a className={cn(HIT, 'inline-block text-footnote text-accent hover:underline')} href={warranty.documentUrl}>
              Open the file
            </a>
          )}
        </div>
      )}
    </Overlay>
  )
}

export const INTERVALS = [
  { value: '0', label: 'One off' },
  { value: '3', label: 'Every 3 mo' },
  { value: '6', label: 'Every 6 mo' },
  { value: '12', label: 'Yearly' },
  { value: '24', label: 'Every 2 yr' },
]

/** What Log service starts filled with: an asset from its drawer, or a whole job from its month row. */
export type LogPrefill = {
  assetId?: string
  serviceId?: string
  what?: string
  vendorId?: string | null
  intervalMonths?: number
}

export function LogServiceDrawer({
  open,
  data,
  prefill = {},
  onClose,
  run,
}: {
  open: boolean
  data: HomeData
  /** Read once on mount: Home keys the drawer by its source so a new one starts fresh. */
  prefill?: LogPrefill
  onClose: () => void
  run: (action: () => Promise<ActionResult>, ok?: string) => void
}) {
  const start = {
    assetId: prefill.assetId ?? data.assets[0]?.id ?? '',
    what: prefill.what ?? '',
    vendorId: prefill.vendorId ?? '',
    intervalMonths: String(prefill.intervalMonths ?? 12),
  }
  const [assetId, setAssetId] = useState(start.assetId)
  const [what, setWhat] = useState(start.what)
  const [doneOn, setDoneOn] = useState(data.todayIso)
  const [cost, setCost] = useState('')
  const [vendorId, setVendorId] = useState(start.vendorId)
  const [intervalMonths, setIntervalMonths] = useState(start.intervalMonths)
  const [notes, setNotes] = useState('')

  const months = Number(intervalMonths)
  const lands = doneOn ? ` (${monthLabelLong(monthKey(addMonths(doneOn, months)))})` : ''
  const dirty =
    assetId !== start.assetId ||
    what !== start.what ||
    doneOn !== data.todayIso ||
    cost !== '' ||
    vendorId !== start.vendorId ||
    intervalMonths !== start.intervalMonths ||
    notes !== ''
  const formId = useId()
  const { errors, ref: formRef, submit } = useFormErrors(() => ({
    what: what.trim() ? undefined : 'Say what was done',
    doneOn: doneOn ? undefined : 'Date is required',
    cost: cost.trim() && parseNumber(cost) === null ? 'Cost must be a number' : undefined,
  }))

  const save = () => {
    if (!submit()) return
    run(
      () =>
        logService({
          assetId,
          // Moved to another asset, it is no longer that asset's job.
          serviceId: assetId === prefill.assetId ? prefill.serviceId : undefined,
          what: what.trim(),
          doneOn,
          // Empty means the receipt is not to hand, which is not a claim that
          // it was free. Null rather than zero.
          costCents: cost.trim() === '' ? null : Math.round(Number(cost.replace(/[^0-9.]/g, '')) * 100),
          vendorId: vendorId || null,
          intervalMonths: months,
          notes: notes.trim(),
        }),
      months > 0
        ? `Logged. Next one scheduled for ${monthLabelLong(monthKey(addMonths(doneOn, months)))}.`
        : 'Logged to the service history.',
    )
    setWhat('')
    setCost('')
    setNotes('')
    onClose()
  }

  return (
    <Overlay
      open={open}
      onClose={onClose}
      narrow
      dirty={dirty}
      eyebrow="New entry"
      title="Log service"
      lede="Logs what was done and, if you pick an interval, schedules the next one on the calendar."
      footer={
        <div className="flex gap-2.5">
          <ActionButton variant="accent" type="submit" form={formId}>
            Save service
          </ActionButton>
          <ActionButton variant="quiet" onClick={onClose}>
            Cancel
          </ActionButton>
        </div>
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
        <div>
          <Eyebrow>Asset</Eyebrow>
          <select
            value={assetId}
            aria-label="Asset"
            onChange={(e) => setAssetId(e.target.value)}
            className={cn(fieldClass, 'mt-2.5')}
          >
            {data.assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <Field label="What was done" required error={errors.what} className="gap-2">
          <input
            value={what}
            aria-label="What was done"
            onChange={(e) => setWhat(e.target.value)}
            placeholder="Replaced the water heater anode rod"
            className={fieldClass}
          />
        </Field>

        <div className="flex flex-wrap gap-3">
          <Field label="Date" required error={errors.doneOn} className="min-w-0 flex-[1_1_140px] gap-2">
            <input
              type="date"
              aria-label="Date"
              value={doneOn}
              onChange={(e) => setDoneOn(e.target.value)}
              className={fieldClass}
            />
          </Field>
          <Field label="Cost" error={errors.cost} className="min-w-0 flex-[1_1_110px] gap-2">
            <input
              inputMode="decimal"
              aria-label="Cost"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="$180"
              className={fieldClass}
            />
          </Field>
        </div>

        <label className="flex flex-col gap-2">
          <Eyebrow>Vendor</Eyebrow>
          <select
            value={vendorId}
            aria-label="Vendor"
            onChange={(e) => setVendorId(e.target.value)}
            className={fieldClass}
          >
            {data.vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
            <option value="">Did it myself</option>
          </select>
        </label>

        <div>
          <Eyebrow>Schedule the next one</Eyebrow>
          <PillGroup
            label="Interval"
            value={intervalMonths}
            options={INTERVALS}
            onChange={setIntervalMonths}
            className="mt-2.5"
          />
        </div>

        <label className="flex flex-col gap-2">
          <Eyebrow>Notes</Eyebrow>
          <textarea
            value={notes}
            aria-label="Notes"
            onChange={(e) => setNotes(e.target.value)}
            onKeyDown={submitOnModEnter}
            placeholder="Part numbers, what to watch, who to call next time"
            className={cn(fieldClass, 'min-h-[88px] resize-y px-3 py-2.5')}
          />
        </label>

        <p className="text-footnote text-secondary-label">
          {months === 0
            ? 'One off: nothing gets added to the calendar.'
            : `The next one lands ${months} months out${lands} on the maintenance calendar.`}
        </p>
      </form>
    </Overlay>
  )
}
