'use client'

import { useId, useState, useTransition } from 'react'
import { ActionButton, Eyebrow, Field, Overlay, fieldClass, submitOnModEnter, useFormErrors, useToast } from '@/components/pos'
import { parseNumber } from '@/core/numbers'
import { cn } from '@/lib/utils'
import { saveAsset } from './actions'
import type { HomeData } from './Home'

const KINDS = [
  { value: 'property', label: 'Property' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'equipment', label: 'Equipment' },
] as const

type Kind = (typeof KINDS)[number]['value']

/** Whole dollars in the field, cents in the row. Empty is zero, as the column defaults. */
const toCents = (text: string) => Math.round((parseNumber(text) ?? 0) * 100)
const toDollars = (cents: number) => (cents ? String(cents / 100) : '')

/** New asset and Edit from the asset drawer: one form over write_asset. */
export function AssetForm({
  asset,
  todayIso,
  onClose,
}: {
  asset: HomeData['assets'][number] | null
  todayIso: string
  onClose: () => void
}) {
  const initial = {
    kind: (asset?.kind ?? 'property') as Kind,
    name: asset?.name ?? '',
    subtitle: asset?.subtitle ?? '',
    acquiredOn: asset?.acquiredOn ?? '',
    value: toDollars(asset?.valueCents ?? 0),
    annualCost: toDollars(asset?.annualCostCents ?? 0),
    notes: asset?.notes ?? '',
  }
  const [d, setD] = useState(initial)
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => d[k] !== initial[k])
  const [pending, start] = useTransition()
  const toast = useToast()
  const formId = useId()
  const money = (text: string) => {
    if (!text.trim()) return undefined
    const n = parseNumber(text)
    return n === null || n < 0 ? 'Enter an amount in dollars' : undefined
  }
  const { errors, ref: formRef, submit } = useFormErrors(() => ({
    name: d.name.trim() ? undefined : 'Name is required',
    value: money(d.value),
    annualCost: money(d.annualCost),
  }))

  const send = (extra: { archived?: boolean } = {}, ok = asset ? 'Saved.' : `Added. ${d.name.trim()}`) =>
    start(async () => {
      const valueCents = toCents(d.value)
      const result = await saveAsset({
        ...(asset && { id: asset.id }),
        kind: d.kind,
        name: d.name.trim(),
        subtitle: d.subtitle.trim(),
        acquired_on: d.acquiredOn || null,
        value_cents: valueCents,
        // The value is an estimate as of the day it was typed, so a new figure
        // carries today's date and an unchanged one keeps the date it had.
        ...(valueCents !== (asset?.valueCents ?? 0) && { value_as_of: todayIso }),
        annual_cost_cents: toCents(d.annualCost),
        notes: d.notes.trim(),
        ...extra,
      })
      if (!result.ok) toast(result.error)
      else {
        toast(ok)
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
          Home <span className="text-secondary-label">/</span> {asset ? 'Edit asset' : 'New asset'}
        </>
      }
      footer={
        <>
          {asset && (
            <ActionButton
              variant="danger"
              size="md"
              disabled={pending}
              onClick={() => send({ archived: true }, `Archived. ${asset.name} leaves the list and the calendar.`)}
            >
              Archive
            </ActionButton>
          )}
          <ActionButton variant="outline" size="md" onClick={onClose}>
            Cancel
          </ActionButton>
          <ActionButton variant="solid" disabled={pending} type="submit" form={formId}>
            Save asset
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
        <Field label="Name" required error={errors.name}>
          <input
            aria-label="Asset name"
            value={d.name}
            onChange={(e) => setD({ ...d, name: e.target.value })}
            placeholder="The house on Elm Street"
            maxLength={200}
            className={fieldClass}
          />
        </Field>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Kind</Eyebrow>
          <select
            aria-label="Kind"
            value={d.kind}
            onChange={(e) => setD({ ...d, kind: e.target.value as Kind })}
            className={fieldClass}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Detail line</Eyebrow>
          <input
            aria-label="Detail line"
            value={d.subtitle}
            onChange={(e) => setD({ ...d, subtitle: e.target.value })}
            placeholder="Mileage, square footage, model"
            maxLength={300}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Purchase date</Eyebrow>
          <input
            type="date"
            aria-label="Purchase date"
            value={d.acquiredOn}
            onChange={(e) => setD({ ...d, acquiredOn: e.target.value })}
            className={fieldClass}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <Field label="Value" error={errors.value} className="min-w-0 flex-[1_1_140px]">
            <input
              inputMode="decimal"
              aria-label="Value"
              value={d.value}
              onChange={(e) => setD({ ...d, value: e.target.value })}
              placeholder="$0"
              className={fieldClass}
            />
          </Field>
          <Field label="Annual cost" error={errors.annualCost} className="min-w-0 flex-[1_1_140px]">
            <input
              inputMode="decimal"
              aria-label="Annual cost"
              value={d.annualCost}
              onChange={(e) => setD({ ...d, annualCost: e.target.value })}
              placeholder="$0"
              className={fieldClass}
            />
          </Field>
        </div>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Notes</Eyebrow>
          <textarea
            aria-label="Notes"
            value={d.notes}
            onChange={(e) => setD({ ...d, notes: e.target.value })}
            onKeyDown={submitOnModEnter}
            maxLength={2000}
            className={cn(fieldClass, 'min-h-[88px] resize-y px-3 py-2.5')}
          />
        </label>
        <p className="text-caption-1 text-secondary-label">
          Value and annual cost are your own estimates. Nothing here looks up a market price.
        </p>
      </form>
    </Overlay>
  )
}
