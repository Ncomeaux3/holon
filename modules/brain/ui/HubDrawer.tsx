'use client'

import { useState } from 'react'
import { ActionButton, Eyebrow, Overlay, fieldClass, useToast } from '@/components/pos'
import { cn } from '@/lib/utils'
import { saveHub } from './actions'
import type { BrainHub, SetParams } from './Brain'

// The hub form, in the Ingest drawer's shape. A hub is a name and the words
// that file a note into it; nothing else. Rules run again on save, so a new
// keyword picks up what was already unfiled.

export function HubDrawer({ hub, setParams }: { hub: BrainHub | null; setParams: SetParams }) {
  const toast = useToast()
  const [name, setName] = useState(hub?.name ?? '')
  const [keywords, setKeywords] = useState(hub?.keywords.join(', ') ?? '')
  const [running, setRunning] = useState(false)

  const ready = name.trim() !== ''
  const close = () => setParams({ hub: null })

  const submit = async () => {
    if (!ready || running) return
    setRunning(true)
    try {
      const result = await saveHub({ id: hub?.id, name, keywords: keywords.split(',') })
      if (!result.ok) return toast(result.error)
      toast('Saved')
      close()
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
          Second Brain <span className="text-secondary-label">/</span> {hub ? 'Edit hub' : 'New hub'}
        </>
      }
      footer={
        <>
          <span className="text-caption-1 text-secondary-label">Notes that mention a keyword are filed here. You can always refile one.</span>
          <ActionButton
            variant="solid"
            disabled={!ready || running}
            onClick={() => void submit()}
          >
            Save hub <span aria-hidden="true">&rarr;</span>
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
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Name</Eyebrow>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hybrid search" className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Keywords · comma separated</Eyebrow>
          <textarea
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            rows={3}
            placeholder="hybrid search, pgvector, embeddings"
            className={cn(fieldClass, 'resize-y leading-[1.6]')}
          />
        </label>
      </form>
    </Overlay>
  )
}
