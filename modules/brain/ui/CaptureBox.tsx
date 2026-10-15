'use client'

import { useEffect, useRef, useState } from 'react'
import { ActionButton, CHEVRON, Eyebrow, submitOnModEnter, useFormErrors, useToast } from '@/components/pos'
import { cn } from '@/lib/utils'
import { fieldClass } from '@/components/pos/field'
import type { Related } from '../related'
import { captureFile, captureText, ingestFromUrl, relatedForDraft } from './actions'
import type { BrainNote, SetParams } from './Brain'

// The capture box pinned above the list (plan: docs/plans/brain-capture.md).
// One textarea, no title field: the first line is the title. A bare URL is
// ingested through the existing tool; anything else is saved as a note, or as
// a daily when it is something worked on. Related notes surface while typing,
// which is the one mechanism that brings an old note back.

const URL_ONLY = /^https?:\/\/\S+$/
const MIN_RELATED = 20

export function CaptureBox({ notes, setParams }: { notes: BrainNote[]; setParams: SetParams }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [worked, setWorked] = useState(false)
  const [running, setRunning] = useState(false)
  // null until the first lookup answers, so the heading appears with its rows.
  const [related, setRelated] = useState<Related[] | 'unavailable' | null>(null)
  const inFlight = useRef(false)
  const pending = useRef<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const trimmed = text.trim()
  const isUrl = URL_ONLY.test(trimmed)
  const wantRelated = !isUrl && trimmed.length >= MIN_RELATED
  const { errors, ref: formRef, submit: validate } = useFormErrors(() => ({
    text: trimmed ? undefined : 'Capture is required',
  }))

  // ponytail: related fires once per pause against a 3 RPM Voyage ceiling;
  // text-only hits when it 429s (search() already falls back).
  useEffect(() => {
    if (!wantRelated) return
    const timer = setTimeout(() => {
      const lookup = async (q: string) => {
        inFlight.current = true
        try {
          const result = await relatedForDraft(q)
          setRelated(result.ok ? (result.related ?? []) : 'unavailable')
        } finally {
          inFlight.current = false
          // Only the last text typed during the call is worth a second one.
          const next = pending.current
          pending.current = null
          if (next !== null) void lookup(next)
        }
      }
      if (inFlight.current) pending.current = trimmed
      else void lookup(trimmed)
    }, 1000)
    return () => clearTimeout(timer)
  }, [trimmed, wantRelated])

  const submit = async () => {
    if (running) return
    if (!validate()) return
    setRunning(true)
    try {
      if (isUrl) {
        const result = await ingestFromUrl(trimmed)
        if (!result.ok) return toast(result.error)
        toast(result.note ? result.note : 'Drafted. It is waiting in the inbox.')
        setParams({ folder: null, note: result.slug ?? null })
      } else {
        const result = await captureText({ text: trimmed, worked })
        if (!result.ok) return toast(result.error)
        toast('Saved')
        setParams({ folder: worked ? 'daily' : 'note', note: result.slug ?? null })
      }
      setText('')
      setWorked(false)
      setRelated(null)
    } finally {
      setRunning(false)
    }
  }

  // A file is a note too: its name is the title and the transcription the body.
  const attach = async (file: File) => {
    if (running) return
    setRunning(true)
    try {
      const form = new FormData()
      form.set('file', file)
      const result = await captureFile(form)
      if (!result.ok) return toast(result.error)
      toast('Saved')
      setParams({ folder: 'note', note: result.slug ?? null })
    } finally {
      setRunning(false)
    }
  }

  const hubNames = (id: string) =>
    notes
      .find((n) => n.id === id)
      ?.hubs.map((h) => h.name)
      .join(' · ') ?? ''

  return (
    <form
      data-testid="brain-capture"
      ref={formRef}
      className="flex flex-col gap-2 border-b border-separator bg-grouped-2 px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          // Rows for the last draft must not reappear under the next one.
          if (e.target.value.trim().length < MIN_RELATED) setRelated(null)
        }}
        onKeyDown={submitOnModEnter}
        rows={3}
        disabled={running}
        aria-label="Capture"
        placeholder="A thought, a link, what you worked on…"
        className={cn(fieldClass, 'resize-y leading-[1.6]')}
      />
      {errors.text && (
        <span role="alert" className="text-footnote text-red-text">
          {errors.text}
        </span>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4">
          <label className={cn('flex min-h-11 items-center gap-2 text-footnote text-secondary-label', isUrl && 'invisible')}>
            <input type="checkbox" checked={worked} onChange={(e) => setWorked(e.target.checked)} className="accent-accent" />
            Worked on
          </label>
          <ActionButton
            variant="quiet"
            size="sm"
            disabled={running}
            onClick={() => fileInput.current?.click()}
          >
            + Attach
          </ActionButton>
          <input
            ref={fileInput}
            type="file"
            accept="image/*,application/pdf"
            aria-label="Attach a file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void attach(file)
              e.target.value = ''
            }}
          />
        </div>
        <ActionButton
          variant="solid"
          disabled={!trimmed || running}
          onClick={() => void submit()}
        >
          {isUrl ? 'Ingest' : 'Save'} <span aria-hidden="true">&rarr;</span>
        </ActionButton>
      </div>

      {wantRelated && related !== null && (
        <div className="mt-1 flex flex-col">
          <Eyebrow>Related</Eyebrow>
          {related === 'unavailable' ? (
            <span className="mt-1.5 text-footnote text-secondary-label">Related notes unavailable</span>
          ) : related.length === 0 ? (
            <span className="mt-1.5 text-footnote text-secondary-label">Nothing close yet</span>
          ) : (
            related.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setParams({ note: r.slug })}
                className="-mx-1.5 flex min-h-11 items-baseline justify-between gap-2 rounded-none border-b border-separator px-1.5 py-1.5 text-left text-footnote text-label transition-colors duration-150 hover:bg-fill-3"
              >
                <span className="min-w-0 truncate">{r.title}</span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="label text-secondary-label">{hubNames(r.id)}</span>
                  <span aria-hidden="true" className={CHEVRON}>
                    &rsaquo;
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </form>
  )
}
