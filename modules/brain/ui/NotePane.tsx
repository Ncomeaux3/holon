'use client'

import { useEffect, useState } from 'react'
import { ActionButton, CHEVRON, Card, ConfirmButton, Eyebrow, SkillPicker, StatusChip, useToast } from '@/components/pos'
import { actionButtonBase, actionButtonSizes, actionButtonVariants } from '@/components/pos/Button'
import { fieldClass } from '@/components/pos/field'
import { cn } from '@/lib/utils'
import { ago, byLine, finishedOn, folderLabel, sourceMeta, subLine, wordCount } from '../shape'
import { blocks } from '../wikilinks'
import type { Related } from '../related'
import { deleteNote, noteFileUrl, publishNote, relatedForNote, saveNote, setNoteHubs, startFromLink, type ActionResult } from './actions'
import { isFinished, type BrainHub, type BrainNote, type SetParams } from './Brain'

// The right pane of POS Second Brain.dc.html: a draft beside the text it was
// drawn from, or a note with its skills, backlinks and vault cell.

// The small pill from the button system: 44px on a phone, 24 from sm up.
const MINI = cn(actionButtonBase, actionButtonSizes.sm, actionButtonVariants.outline)
const MINI_ACCENT = cn(actionButtonBase, actionButtonSizes.sm, actionButtonVariants.brand)

type Run = (action: () => Promise<ActionResult>, ok?: string) => void

export function NotePane({
  note,
  hubs,
  skills: tree,
  setParams,
  run,
}: {
  note: BrainNote
  hubs: BrainHub[]
  skills: [string, string][]
  setParams: SetParams
  run: Run
}) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(note.body)
  const [hubsEditing, setHubsEditing] = useState(false)
  const [picked, setPicked] = useState<string[]>(() => note.hubs.map((h) => h.id))
  // Fetched on open rather than for every note on the page: a nearest
  // neighbour query per note is the one thing the page load should not pay.
  const [related, setRelated] = useState<Related[] | null>(null)

  useEffect(() => {
    if (note.status !== 'published') return
    let live = true
    void relatedForNote(note.id).then((r) => {
      if (live) setRelated(r.ok ? (r.related ?? []) : [])
    })
    return () => {
      live = false
    }
  }, [note.id, note.status])

  const toggleEdit = () => {
    setBody(note.body)
    setEditing((e) => !e)
  }
  const editLabel = editing ? 'Cancel edit' : 'Edit'

  const skills = note.entityRef ? (
    <SkillPicker entityRef={note.entityRef} links={note.skills} skills={tree} />
  ) : (
    <span className="text-caption-1 text-secondary-label">Nothing matched yet.</span>
  )

  if (note.status === 'draft') {
    const accept = () => {
      const save = editing && body !== note.body ? () => saveNote({ id: note.id, body }) : null
      run(async () => {
        if (save) {
          const saved = await save()
          if (!saved.ok) return saved
        }
        return publishNote(note.id, true)
      }, 'Accepted')
      setEditing(false)
    }
    const discard = () => {
      run(() => deleteNote(note.id), 'Discarded')
      setParams({ note: null })
    }

    return (
      <>
        <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-[18px]">
          <div className="min-w-0">
            <Eyebrow className="text-orange-text">Draft · awaiting your approval</Eyebrow>
            <h2 className="mt-2 text-title-2 text-label">{note.title}</h2>
            <p className="mt-1.5 text-footnote text-secondary-label">
              {subLine(note)} · will file under{' '}
              <span className="num">
                {folderLabel(note.kind)} / {note.slug}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <ConfirmButton
              confirmLabel="Discard"
              title="Discard this draft?"
              message="The draft and the source text it was drawn from are deleted."
              onConfirm={discard}
            >
              Discard
            </ConfirmButton>
            <ActionButton variant="outline" onClick={toggleEdit}>
              {editLabel}
            </ActionButton>
            <ActionButton variant="solid" onClick={accept}>
              Accept <span aria-hidden="true">&rarr;</span>
            </ActionButton>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-3.5 px-6 pb-6 pt-4">
          <Card className="flex min-h-[280px] flex-col overflow-hidden p-0">
            <div className="flex justify-between gap-2 border-b border-separator px-3.5 py-2.5">
              <Eyebrow>Source</Eyebrow>
              <span className="num text-footnote text-secondary-label">{sourceMeta(note)}</span>
            </div>
            <p className="overflow-auto whitespace-pre-wrap p-3.5 text-subheadline text-label">
              {note.sourceText || 'No source text was kept for this draft.'}
            </p>
          </Card>
          {/* The action ring says this is the pane the buttons act on. */}
          <Card className="flex min-h-[280px] flex-col overflow-hidden p-0 ring-1 ring-accent">
            <div className="flex justify-between gap-2 border-b border-separator px-3.5 py-2.5">
              <Eyebrow>Draft summary</Eyebrow>
              <span className="num text-footnote text-secondary-label">
                {note.sourceUrl && note.body ? 'Haiku · ' : ''}
                {wordCount(note.body)} words
              </span>
            </div>
            {editing ? (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                aria-label={`Draft of ${note.title}`}
                className="flex-1 resize-none bg-fill-3 p-3.5 text-subheadline text-label outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)"
              />
            ) : note.body ? (
              <p className="flex-1 overflow-auto whitespace-pre-wrap p-3.5 text-subheadline text-label">
                {note.body}
              </p>
            ) : (
              // The summary the cap stopped: the ingest's own note says why.
              <p className="flex-1 p-3.5 text-subheadline text-secondary-label">
                {note.sourceMeta || 'No summary was drafted.'}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-1.5 border-t border-separator px-3.5 py-2.5">
              <Eyebrow className="mr-1">Skills</Eyebrow>
              {skills}
            </div>
          </Card>
        </div>
      </>
    )
  }

  const inVault = note.source === 'vault'
  const save = () => {
    run(() => saveNote({ id: note.id, body }), 'Saved')
    setEditing(false)
  }

  return (
    <div className="flex flex-col gap-4 px-6 pb-6 pt-[18px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>
            {folderLabel(note.kind)} <span className="text-secondary-label">/</span> {note.slug}.md
          </Eyebrow>
          <h2 className="mt-2 text-title-2 text-label">{note.title}</h2>
          <p className="mt-1.5 text-footnote text-secondary-label">{subLine(note)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isFinished(note) && (
            <StatusChip tone="ok">Finished · {finishedOn(note.updatedAt)}</StatusChip>
          )}
          {inVault ? (
            <span className="text-caption-1 text-secondary-label">A file in the vault. Edit it there.</span>
          ) : (
            <button type="button" onClick={toggleEdit} className={MINI}>
              {editLabel}
            </button>
          )}
          {editing && (
            <button
              type="button"
              onClick={save}
              className={MINI_ACCENT}
            >
              Save
            </button>
          )}
        </div>
      </div>

      {/* Hubs, the owner's groupings. Edit turns the chips into checkboxes
        * over every hub; a tick is manual and wins over a rule or a guess. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Eyebrow className="mr-1">Hubs</Eyebrow>
        {hubsEditing ? (
          <>
            {hubs.map((h) => (
              <label key={h.id} className={cn(picked.includes(h.id) ? MINI_ACCENT : MINI, 'cursor-pointer')}>
                <input
                  type="checkbox"
                  checked={picked.includes(h.id)}
                  onChange={(e) =>
                    setPicked((p) => (e.target.checked ? [...p, h.id] : p.filter((id) => id !== h.id)))
                  }
                  className="accent-accent"
                />
                {h.name}
              </label>
            ))}
            <button
              type="button"
              onClick={() => {
                run(() => setNoteHubs(note.id, picked), 'Filed')
                setHubsEditing(false)
              }}
              className={MINI_ACCENT}
            >
              Save
            </button>
          </>
        ) : (
          <>
            {note.hubs.length === 0 && <span className="text-caption-1 text-secondary-label">Unfiled</span>}
            {note.hubs.map((h) => (
              <button key={h.id} type="button" onClick={() => setParams({ folder: `hub:${hubs.find((x) => x.id === h.id)?.slug ?? ''}`, note: null })} className={MINI}>
                {h.name}
              </button>
            ))}
            {hubs.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setPicked(note.hubs.map((h) => h.id))
                  setHubsEditing(true)
                }}
                className={MINI}
              >
                Edit
              </button>
            )}
            {note.hubs.length > 0 && (
              <span className="label ml-auto text-secondary-label">{byLine(note.hubs)}</span>
            )}
          </>
        )}
      </div>

      {/* The file this note was transcribed from. A signed URL, fetched on click. */}
      {note.filePath && (
        <button
          type="button"
          onClick={() =>
            void noteFileUrl(note.id).then((r) => (r.ok ? window.open(r.url, '_blank', 'noopener') : toast(r.error)))
          }
          className="flex min-h-11 items-center gap-1 self-start text-footnote text-secondary-label underline-offset-2 transition-colors duration-150 hover:text-label hover:underline"
        >
          File <span aria-hidden="true">&rarr;</span> {note.filePath.slice(note.filePath.indexOf('/') + 1)}
        </button>
      )}

      {editing ? (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={14}
          aria-label={`Body of ${note.title}`}
          className={cn(fieldClass, 'resize-y p-4')}
        />
      ) : (
        <div className="flex max-w-[720px] flex-col gap-2.5 text-body text-label">
          {blocks(note.body).map((b, i) =>
            b.kind === 'ul' ? (
              <ul key={i} className="flex list-disc flex-col gap-1 pl-[18px]">
                {b.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            ) : (
              <p key={i}>
                {b.parts.map((part, j) =>
                  typeof part === 'string' ? (
                    part
                  ) : (
                    <button
                      key={j}
                      type="button"
                      onClick={() => setParams({ note: part.link })}
                      className="rounded-none border-b border-accent text-accent"
                    >
                      {part.label}
                    </button>
                  ),
                )}
              </p>
            ),
          )}
        </div>
      )}

      <div className="grid max-w-[720px] grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3.5">
        <Card>
          <Eyebrow>Linked skills</Eyebrow>
          <div className="mt-2">{skills}</div>
        </Card>
        <Card>
          <Eyebrow>Backlinks</Eyebrow>
          <div className="mt-1.5 flex flex-col">
            {note.backlinks.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setParams({ note: b.slug })}
                className="-mx-1.5 flex min-h-11 items-baseline justify-between gap-2 rounded-none border-b border-separator px-1.5 py-1.5 text-left text-footnote text-label transition-colors duration-150 hover:bg-fill-3"
              >
                <span className="min-w-0 truncate">[[{b.title}]]</span>
                <span aria-hidden="true" className={CHEVRON}>
                  &rsaquo;
                </span>
              </button>
            ))}
            {note.backlinks.length === 0 && <span className="text-footnote text-secondary-label">None yet</span>}
          </div>
        </Card>
        <Card>
          <Eyebrow>Related</Eyebrow>
          <div className="mt-1.5 flex flex-col">
            {(related ?? []).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setParams({ note: r.slug })}
                className="-mx-1.5 flex min-h-11 items-baseline justify-between gap-2 rounded-none border-b border-separator px-1.5 py-1.5 text-left text-footnote text-label transition-colors duration-150 hover:bg-fill-3"
              >
                <span className="min-w-0 truncate">{r.title}</span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="num text-caption-1 text-secondary-label">{Math.round(r.similarity * 100)}%</span>
                  <span aria-hidden="true" className={CHEVRON}>
                    &rsaquo;
                  </span>
                </span>
              </button>
            ))}
            {(related === null || related.length === 0) && <span className="text-footnote text-secondary-label">None yet</span>}
          </div>
        </Card>
        <Card>
          <Eyebrow>Vault</Eyebrow>
          <div className="mt-1.5">
            {inVault ? (
              <div className="flex justify-between gap-2 border-b border-separator py-1.5 text-footnote text-label">
                <span className="min-w-0 truncate">{note.externalId}</span>
                <span className="num shrink-0 text-caption-1 text-secondary-label">
                  {note.vaultSha.slice(0, 7)} · {ago(note.updatedAt)}
                </span>
              </div>
            ) : (
              <span className="text-footnote text-secondary-label">Not in the vault. Nothing here writes to it.</span>
            )}
          </div>
        </Card>
        {note.unresolved.length > 0 && (
          <Card>
            <Eyebrow>Links to write</Eyebrow>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {note.unresolved.map((slug) => (
                <button
                  key={slug}
                  type="button"
                  onClick={() => run(() => startFromLink(slug), `Started ${slug}`)}
                  className={MINI}
                >
                  {slug.replace(/-/g, ' ')}
                </button>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
