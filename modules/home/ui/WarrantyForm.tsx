'use client'

import { useId, useState, useTransition } from 'react'
import { ActionButton, Eyebrow, Field, Overlay, fieldClass, useFormErrors, useToast } from '@/components/pos'
import { saveWarranty } from './actions'
import type { HomeData } from './Home'

/** Add a warranty or document, and Edit from its drawer: one form over write_warranty. */
export function WarrantyForm({
  warranty,
  data,
  onClose,
}: {
  warranty: HomeData['warranties'][number] | null
  data: HomeData
  onClose: () => void
}) {
  const initial = {
    name: warranty?.name ?? '',
    assetId: warranty?.assetId ?? '',
    cover: warranty?.cover ?? '',
    detail: warranty?.detail ?? '',
    expiresOn: warranty?.expiresOn ?? '',
    documentUrl: warranty?.documentUrl ?? '',
  }
  const [d, setD] = useState(initial)
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => d[k] !== initial[k])
  const [pending, start] = useTransition()
  const toast = useToast()
  const formId = useId()
  const { errors, ref: formRef, submit } = useFormErrors(() => ({
    name: d.name.trim() ? undefined : 'Name is required',
    documentUrl: !d.documentUrl.trim() || /^https?:\/\/./.test(d.documentUrl.trim()) && URL.canParse(d.documentUrl.trim()) ? undefined : 'Paste a full link, starting https://',
  }))

  const save = () =>
    start(async () => {
      const result = await saveWarranty({
        ...(warranty && { id: warranty.id }),
        name: d.name.trim(),
        asset_id: d.assetId || null,
        cover: d.cover.trim(),
        detail: d.detail.trim(),
        expires_on: d.expiresOn || null,
        document_url: d.documentUrl.trim(),
      })
      if (!result.ok) toast(result.error)
      else {
        toast(warranty ? 'Saved.' : `Added. ${d.name.trim()}`)
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
          Home <span className="text-secondary-label">/</span> {warranty ? 'Edit warranty' : 'New warranty'}
        </>
      }
      footer={
        <>
          <ActionButton variant="outline" size="md" onClick={onClose}>
            Cancel
          </ActionButton>
          <ActionButton variant="solid" disabled={pending} type="submit" form={formId}>
            Save warranty
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
          if (submit()) save()
        }}
      >
        <Field label="Name" required error={errors.name}>
          <input
            aria-label="Warranty name"
            value={d.name}
            onChange={(e) => setD({ ...d, name: e.target.value })}
            placeholder="Water heater parts"
            maxLength={200}
            className={fieldClass}
          />
        </Field>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Asset</Eyebrow>
          <select
            aria-label="Asset"
            value={d.assetId}
            onChange={(e) => setD({ ...d, assetId: e.target.value })}
            className={fieldClass}
          >
            <option value="">No single asset</option>
            {data.assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="flex min-w-0 flex-[1_1_140px] flex-col gap-1.5">
            <Eyebrow>Cover</Eyebrow>
            <input
              aria-label="Cover"
              value={d.cover}
              onChange={(e) => setD({ ...d, cover: e.target.value })}
              placeholder="10 yr parts"
              maxLength={60}
              className={fieldClass}
            />
          </label>
          <label className="flex min-w-0 flex-[1_1_140px] flex-col gap-1.5">
            <Eyebrow>Ends on</Eyebrow>
            <input
              type="date"
              aria-label="Ends on"
              value={d.expiresOn}
              onChange={(e) => setD({ ...d, expiresOn: e.target.value })}
              className={fieldClass}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Detail</Eyebrow>
          <input
            aria-label="Detail"
            value={d.detail}
            onChange={(e) => setD({ ...d, detail: e.target.value })}
            placeholder="Registered with the maker, receipt in the drawer"
            maxLength={300}
            className={fieldClass}
          />
        </label>
        <Field label="Document link" error={errors.documentUrl}>
          <input
            inputMode="url"
            aria-label="Document link"
            value={d.documentUrl}
            onChange={(e) => setD({ ...d, documentUrl: e.target.value })}
            placeholder="https://"
            className={fieldClass}
          />
        </Field>
        <p className="text-caption-1 text-secondary-label">
          Leave Ends on empty for something that does not expire, like a deed. An end date shows on the Calendar.
        </p>
      </form>
    </Overlay>
  )
}
