'use client'

import { useId, useState, useTransition } from 'react'
import { ActionButton, Eyebrow, Field, Overlay, PillGroup, fieldClass, useFormErrors, useToast } from '@/components/pos'
import { parseNumber } from '@/core/numbers'
import { addMonths, intervalLabel, monthKey, monthLabelLong } from '../schedule'
import { saveSchedule } from './actions'
import { INTERVALS } from './Drawers'
import type { HomeData, Service } from './Home'

/**
 * Schedule service, and Edit on a month row: one form over schedule_service.
 *
 * The date is always asked for. A new job has never been done, so an interval
 * alone gives nextDue() nothing to count from and the job would never reach
 * the calendar. The date is written as `due_on`, the one-off override the
 * schema already has: logging the job clears it and the interval takes over.
 */
export function ScheduleDrawer({
  service,
  assetId,
  data,
  onClose,
}: {
  service: Service | null
  /** The asset to start on when opened from its drawer. */
  assetId: string | null
  data: HomeData
  onClose: () => void
}) {
  const initial = {
    assetId: service?.assetId ?? assetId ?? data.assets[0]?.id ?? '',
    title: service?.title ?? '',
    intervalMonths: String(service?.intervalMonths ?? 12),
    dueOn: service?.dueOn ?? '',
    vendorId: service?.vendorId ?? '',
    cost: service?.costEstimateCents ? String(service.costEstimateCents / 100) : '',
  }
  const [d, setD] = useState(initial)
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => d[k] !== initial[k])
  const [pending, start] = useTransition()
  const toast = useToast()
  const formId = useId()
  const { errors, ref: formRef, submit } = useFormErrors(() => ({
    title: d.title.trim() ? undefined : 'Say what the job is',
    dueOn: d.dueOn ? undefined : 'Pick when it is next due',
    cost: d.cost.trim() && (parseNumber(d.cost) ?? -1) < 0 ? 'Enter an amount in dollars' : undefined,
  }))
  // An interval in the list's own terms, so an unusual one stays selectable.
  const intervals = INTERVALS.some((i) => i.value === initial.intervalMonths)
    ? INTERVALS
    : [...INTERVALS, { value: initial.intervalMonths, label: intervalLabel(Number(initial.intervalMonths)) }]
  const months = Number(d.intervalMonths)

  const send = (extra: { active?: boolean } = {}, ok?: string) =>
    start(async () => {
      const result = await saveSchedule({
        ...(service ? { id: service.id } : { asset_id: d.assetId }),
        ...(service && d.assetId !== service.assetId && { asset_id: d.assetId }),
        title: d.title.trim(),
        vendor_id: d.vendorId || null,
        interval_months: months,
        // On an edit the date is written only when it moved, so a date worked
        // out from the interval is not pinned as an override by saving.
        ...((!service || d.dueOn !== initial.dueOn) && { due_on: d.dueOn }),
        cost_estimate_cents: Math.round((parseNumber(d.cost) ?? 0) * 100),
        ...extra,
      })
      if (!result.ok) toast(result.error)
      else {
        toast(ok ?? `Scheduled for ${monthLabelLong(monthKey(d.dueOn))}.`)
        onClose()
      }
    })

  return (
    <Overlay
      open
      narrow
      onClose={onClose}
      dirty={dirty}
      eyebrow={
        <>
          Home <span className="text-secondary-label">/</span> {service ? 'Edit service' : 'Schedule service'}
        </>
      }
      footer={
        <>
          {service && (
            <ActionButton
              variant="danger"
              size="md"
              disabled={pending}
              onClick={() => send({ active: false }, 'Unscheduled. Its history stays with the asset.')}
            >
              Stop scheduling
            </ActionButton>
          )}
          <ActionButton variant="outline" size="md" onClick={onClose}>
            Cancel
          </ActionButton>
          <ActionButton variant="solid" disabled={pending} type="submit" form={formId}>
            Save service
          </ActionButton>
        </>
      }
    >
      <form
        id={formId}
        ref={formRef}
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (submit()) send()
        }}
      >
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Asset</Eyebrow>
          <select
            aria-label="Asset"
            value={d.assetId}
            onChange={(e) => setD({ ...d, assetId: e.target.value })}
            className={fieldClass}
          >
            {data.assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <Field label="Job" required error={errors.title}>
          <input
            aria-label="Job"
            value={d.title}
            onChange={(e) => setD({ ...d, title: e.target.value })}
            placeholder="Gutter clean"
            maxLength={200}
            className={fieldClass}
          />
        </Field>
        <div>
          <Eyebrow>How often</Eyebrow>
          <PillGroup
            label="How often"
            value={d.intervalMonths}
            options={intervals}
            onChange={(v) => setD({ ...d, intervalMonths: v })}
            className="mt-2.5"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <Field label="Next due" required error={errors.dueOn} className="min-w-0 flex-[1_1_140px]">
            <input
              type="date"
              aria-label="Next due"
              value={d.dueOn}
              onChange={(e) => setD({ ...d, dueOn: e.target.value })}
              className={fieldClass}
            />
          </Field>
          <Field label="Estimated cost" error={errors.cost} className="min-w-0 flex-[1_1_140px]">
            <input
              inputMode="decimal"
              aria-label="Estimated cost"
              value={d.cost}
              onChange={(e) => setD({ ...d, cost: e.target.value })}
              placeholder="$0"
              className={fieldClass}
            />
          </Field>
        </div>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Vendor</Eyebrow>
          <select
            aria-label="Vendor"
            value={d.vendorId}
            onChange={(e) => setD({ ...d, vendorId: e.target.value })}
            className={fieldClass}
          >
            <option value="">No vendor</option>
            {data.vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-caption-1 text-secondary-label">
          {months === 0
            ? 'One off: it shows once on the calendar and leaves when it is logged.'
            : d.dueOn
              ? `After this one it comes round ${intervalLabel(months)}, so the one after lands in ${monthLabelLong(monthKey(addMonths(d.dueOn, months)))}.`
              : `It comes round ${intervalLabel(months)}, counted from each time it is logged.`}
        </p>
      </form>
    </Overlay>
  )
}
