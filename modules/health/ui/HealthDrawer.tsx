'use client'

import { useId, useState } from 'react'
import {
  ActionButton,
  Eyebrow,
  Field,
  Overlay,
  PillGroup,
  SkillPicker,
  fieldClass,
  submitOnModEnter,
  useFormErrors,
} from '@/components/pos'
import { parseNumber } from '@/core/numbers'
import { cn } from '@/lib/utils'
import { logVisit, recordUrl, setAppointmentStatus, type ActionResult } from './actions'
import { KIND_LABEL, longWhen, recordDate, type Appointment, type HealthRecord } from './Health'

// The one drawer on the Health page: keyed rows for an appointment or a
// record, or the Log a visit form. The artboard's drawer has no band of its
// own, so the shared band's crumb carries the kind.

const key = 'w-[120px] shrink-0 text-footnote text-secondary-label'

export function HealthDrawer({
  appointment,
  record,
  isNew,
  providers,
  todayIso,
  skills,
  onClose,
  onRun,
}: {
  appointment: Appointment | null
  record: HealthRecord | null
  isNew: boolean
  providers: { id: string; name: string; role: string }[]
  todayIso: string
  skills: [string, string][]
  onClose: () => void
  onRun: (action: () => Promise<ActionResult>, ok?: string) => void
}) {
  if (isNew) return <Form providers={providers} todayIso={todayIso} onClose={onClose} onRun={onRun} />
  if (appointment) return <AppointmentView appointment={appointment} skills={skills} onClose={onClose} onRun={onRun} />
  if (record) return <RecordView record={record} skills={skills} onClose={onClose} />
  return null
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <div className="mt-[22px]">
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k} className="flex flex-wrap items-baseline gap-2 gap-x-3.5 border-b border-separator py-[13px]">
            <span className={key}>{k.charAt(0).toUpperCase() + k.slice(1)}</span>
            <span className="min-w-0 flex-[1_1_160px] text-subheadline text-label">{v}</span>
          </div>
        ))}
    </div>
  )
}

function Head({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <h2 className="text-title-2 text-label">{title}</h2>
      {sub && <p className="mt-2 text-footnote text-secondary-label">{sub}</p>}
    </>
  )
}

function AppointmentView({
  appointment: a,
  skills,
  onClose,
  onRun,
}: {
  appointment: Appointment
  skills: [string, string][]
  onClose: () => void
  onRun: (action: () => Promise<ActionResult>, ok?: string) => void
}) {
  const past = a.status === 'done' || a.status === 'cancelled' || new Date(a.startsAt) < new Date()
  return (
    <Overlay open narrow onClose={onClose} eyebrow={past ? 'Past visit' : 'Appointment'}>
      <Head title={a.what} sub={[a.provider, a.location].filter(Boolean).join(' · ')} />
      <Rows
        rows={[
          ['When', longWhen(a.startsAt)],
          ['Where', a.location || a.providerAddress || ''],
          ['Provider', a.provider ? `${a.provider}${a.providerRole ? ` · ${a.providerRole}` : ''}` : ''],
          ['Prep', a.prep],
          ['Status', a.status.charAt(0).toUpperCase() + a.status.slice(1)],
          ['Cost estimate', a.costCents === null ? '' : `$${(a.costCents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`],
        ]}
      />
      {a.notes && (
        <div className="mt-5">
          <Eyebrow>Notes</Eyebrow>
          <p className="mt-2.5 text-footnote text-label">{a.notes}</p>
        </div>
      )}
      <div className="mt-5">
        <Eyebrow>Linked skills</Eyebrow>
        {a.entityRef ? (
          <SkillPicker entityRef={a.entityRef} links={a.skills} skills={skills} className="mt-2" />
        ) : (
          <p className="mt-2 text-footnote text-secondary-label">Nothing matched yet.</p>
        )}
      </div>
      {!past && (
        <div className="mt-[26px] flex flex-wrap gap-2.5">
          <ActionButton
            variant="accent"
            onClick={() => {
              onRun(() => setAppointmentStatus(a.id, 'done'), 'Marked done')
              onClose()
            }}
          >
            Mark done
          </ActionButton>
        </div>
      )}
    </Overlay>
  )
}

function RecordView({ record: r, skills, onClose }: { record: HealthRecord; skills: [string, string][]; onClose: () => void }) {
  const [opening, setOpening] = useState(false)
  return (
    <Overlay open narrow onClose={onClose} eyebrow={`Record · ${r.kind}`}>
      <Head title={r.title} sub={[recordDate(r.takenOn), r.file ?? 'No file', r.summary].filter(Boolean).join(' · ')} />
      <Rows rows={[...Object.entries(r.fields), ...(r.summary ? ([['Summary', r.summary]] as [string, string][]) : [])]} />
      <div className="mt-5">
        <Eyebrow>Linked skills</Eyebrow>
        {r.entityRef ? (
          <SkillPicker entityRef={r.entityRef} links={r.skills} skills={skills} className="mt-2" />
        ) : (
          <p className="mt-2 text-footnote text-secondary-label">Nothing matched yet.</p>
        )}
      </div>
      {r.file && (
        <div className="mt-[26px] flex flex-wrap gap-2.5">
          <ActionButton
            disabled={opening}
            onClick={async () => {
              setOpening(true)
              const result = await recordUrl(r.id)
              setOpening(false)
              if (result.ok) window.open(result.url, '_blank', 'noopener')
            }}
          >
            Open the file
          </ActionButton>
        </div>
      )}
    </Overlay>
  )
}

const KINDS = ['visit', 'lab', 'imaging', 'dental', 'vision', 'immunisation'] as const

function Form({
  providers,
  todayIso,
  onClose,
  onRun,
}: {
  providers: { id: string; name: string; role: string }[]
  todayIso: string
  onClose: () => void
  onRun: (action: () => Promise<ActionResult>, ok?: string) => void
}) {
  const [kind, setKind] = useState<(typeof KINDS)[number]>('visit')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayIso)
  const [cost, setCost] = useState('')
  const defaultProvider = (providers.find((p) => /primary/i.test(p.role)) ?? providers[0])?.id ?? ''
  const [provider, setProvider] = useState(defaultProvider)
  const [notes, setNotes] = useState('')
  const future = date > todayIso
  const dirty =
    kind !== 'visit' ||
    title !== '' ||
    date !== todayIso ||
    cost !== '' ||
    provider !== defaultProvider ||
    notes !== ''
  const formId = useId()
  const { errors, ref: formRef, submit } = useFormErrors(() => ({
    title: title.trim() ? undefined : 'Title is required',
    date: date ? undefined : 'Date is required',
    cost: cost.trim() && parseNumber(cost) === null ? 'Cost must be a number' : undefined,
  }))

  return (
    <Overlay open narrow onClose={onClose} dirty={dirty} eyebrow="New entry">
      <Head title="Log a visit" sub="A date in the future lands on the appointment list; anything past goes straight to records." />
      <form
        id={formId}
        ref={formRef}
        className="mt-[22px] flex flex-col gap-[18px]"
        onSubmit={(e) => {
          e.preventDefault()
          if (!submit()) return
          const form = new FormData(e.currentTarget)
          form.set('kind', kind)
          onRun(() => logVisit(form), future ? 'Saved. It is on the appointment list.' : 'Saved to records.')
          onClose()
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Eyebrow>Type</Eyebrow>
          <PillGroup
            label="Type"
            value={kind}
            onChange={setKind}
            options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          />
        </div>
        <Field label="Title" required error={errors.title}>
          <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Annual physical" className={fieldClass} />
        </Field>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Provider</Eyebrow>
          <select name="provider" value={provider} onChange={(e) => setProvider(e.target.value)} className={fieldClass}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.role.toLowerCase()}
              </option>
            ))}
            <option value="">Other · name it in the notes</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-3">
          <Field label="Date" required error={errors.date} className="min-w-0 flex-[1_1_140px]">
            <input name="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(fieldClass, 'num')} />
          </Field>
          <Field label="Cost" error={errors.cost} className="min-w-0 flex-[1_1_120px]">
            <input name="cost" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="$40 copay" className={fieldClass} />
          </Field>
        </div>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Notes</Eyebrow>
          <textarea
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onKeyDown={submitOnModEnter}
            placeholder="What was decided, what to follow up on"
            className={cn(fieldClass, 'min-h-24 resize-y leading-normal')}
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <Eyebrow>Attachment</Eyebrow>
          <input
            name="file"
            type="file"
            accept="application/pdf,image/*"
            disabled={future}
            aria-label="Attachment"
            className="block w-full text-footnote text-secondary-label file:mr-3 file:min-h-11 file:rounded-full file:border-0 file:bg-fill-3 file:px-3 file:text-footnote file:font-medium file:text-label disabled:opacity-100"
          />
          {future && <p className="mt-1.5 text-caption-1 text-secondary-label">Files attach to a record, once the visit has happened.</p>}
        </div>
        <p className="text-footnote text-secondary-label">
          {future
            ? 'Future date: this will appear under Appointments.'
            : 'Past date: this files under Records.'}
        </p>
        <div className="mt-2 flex flex-wrap gap-2.5">
          <ActionButton type="submit" variant="accent">
            Save entry
          </ActionButton>
          <ActionButton onClick={onClose}>Cancel</ActionButton>
        </div>
      </form>
    </Overlay>
  )
}
