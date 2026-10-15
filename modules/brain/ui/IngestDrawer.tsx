'use client'

import { useState } from 'react'
import { ActionButton, Card, Eyebrow, Overlay, PillGroup, fieldClass, useToast } from '@/components/pos'
import { cn } from '@/lib/utils'
import { KINDS, folderLabel } from '../shape'
import { ingestFromUrl, saveNote } from './actions'
import type { SetParams } from './Brain'

// The Ingest drawer of POS Second Brain.dc.html, at 480px. URL and YouTube
// spend one Haiku call and land in the inbox as a draft; Book and Note are the
// owner's own words and save straight to their folder. PDF is not built: there
// is no extractor and the Node runtime cannot run one.

type Kind = 'url' | 'youtube' | 'book' | 'note'

const KIND_LABEL: Record<Kind, string> = { url: 'URL', youtube: 'YouTube', book: 'Book', note: 'Note' }
const DEFAULT_FOLDER: Record<Kind, string> = { url: 'article', youtube: 'video', book: 'book', note: 'note' }

export function IngestDrawer({ setParams }: { setParams: SetParams }) {
  const toast = useToast()
  const [kind, setKind] = useState<Kind>('url')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [folder, setFolder] = useState('article')
  // Separate from a transition: fetching a page and summarising it takes
  // seconds, and a button that looks idle for that long gets pressed twice.
  const [running, setRunning] = useState(false)

  const fromUrl = kind === 'url' || kind === 'youtube'
  const ready = fromUrl ? url.trim() !== '' : title.trim() !== ''
  const close = () => setParams({ ingest: null })

  const pick = (next: Kind) => {
    setKind(next)
    setFolder(DEFAULT_FOLDER[next])
  }

  const submit = async () => {
    if (!ready || running) return
    setRunning(true)
    try {
      if (fromUrl) {
        const result = await ingestFromUrl(url.trim(), folder)
        if (!result.ok) return toast(result.error)
        toast(result.note ? result.note : 'Drafted. It is waiting in the inbox.')
        setParams({ ingest: null, folder: null, note: result.slug ?? null })
      } else {
        const result = await saveNote({ title: title.trim(), body: notes, kind: folder })
        if (!result.ok) return toast(result.error)
        toast('Saved')
        setParams({ ingest: null, folder, note: result.slug ?? null })
      }
    } finally {
      setRunning(false)
    }
  }

  return (
    <Overlay
      open
      narrow
      onClose={close}
      eyebrow={
        <>
          Second Brain <span className="text-secondary-label">/</span> Ingest
        </>
      }
      footer={
        <>
          <span className="text-caption-1 text-secondary-label">
            {fromUrl
              ? 'Lands in the inbox as a draft. Nothing reaches the vault.'
              : 'Saved as a note of yours. Nothing reaches the vault.'}
          </span>
          <ActionButton
            variant="solid"
            disabled={!ready || running}
            onClick={() => void submit()}
          >
            {fromUrl ? 'Draft summary' : 'Save note'} <span aria-hidden="true">&rarr;</span>
          </ActionButton>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div data-testid="brain-ingest-kinds">
          <PillGroup
            options={(Object.keys(KIND_LABEL) as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
            value={kind}
            onChange={pick}
            label="Kind"
          />
        </div>

        {fromUrl ? (
          <>
            <label className="flex flex-col gap-1.5">
              <Eyebrow>{kind === 'youtube' ? 'YouTube link' : 'URL'}</Eyebrow>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={running}
                placeholder={kind === 'youtube' ? 'https://youtube.com/watch?v=…' : 'https://…'}
                className={cn(fieldClass, 'code')}
              />
            </label>
            <p className="text-footnote leading-[1.5] text-secondary-label">
              {kind === 'youtube'
                ? 'Captions off the watch page, automatic ones when no written track exists; a video with no captions says so. A summary is drafted, then you approve it in the inbox.'
                : 'Readable text out of the page. A summary is drafted, then you approve it in the inbox.'}
            </p>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1.5">
              <Eyebrow>{kind === 'book' ? 'Title · author' : 'Title'}</Eyebrow>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={kind === 'book' ? 'Designing Data-Intensive Applications · Kleppmann' : 'What is it about?'}
                className={fieldClass}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <Eyebrow>Your notes</Eyebrow>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={6}
                placeholder="Key ideas, quotes, what changed your mind…"
                className={cn(fieldClass, 'resize-y leading-[1.6]')}
              />
            </label>
          </>
        )}

        <label className="flex flex-col gap-1.5 sm:w-[calc(50%-6px)]">
          <Eyebrow>Folder</Eyebrow>
          <select value={folder} onChange={(e) => setFolder(e.target.value)} className={fieldClass}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {folderLabel(k)}
              </option>
            ))}
          </select>
        </label>

        {running && (
          <Card selected className="flex items-center gap-2.5 px-3.5 py-3 text-footnote">
            <span className="status-dot" aria-hidden />
            Reading, drafting, classifying · a few seconds
          </Card>
        )}
      </form>
    </Overlay>
  )
}
