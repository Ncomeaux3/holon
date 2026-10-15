'use client'

import { useTransition } from 'react'
import { ActionButton, BandSearch, CHEVRON, PillGroup, SearchButton, StatusChip, useToast } from '@/components/pos'
import { BackControl } from '@/components/pos/BackControl'
import { useSearchState } from '@/components/pos/searchState'
import { cn } from '@/lib/utils'
import { KINDS, ago, finishedOn, folderLabel, subLine } from '../shape'
import type { ActionResult } from './actions'
import { CaptureBox } from './CaptureBox'
import { HubDrawer } from './HubDrawer'
import { IngestDrawer } from './IngestDrawer'
import { NotePane } from './NotePane'

// POS Second Brain.dc.html: the band, the folder row, the list and the note
// pane. The folder, the open note and the ingest drawer live in the URL, so a
// note can be linked to and all three survive a refresh.

export type BrainNote = {
  id: string
  title: string
  body: string
  slug: string
  kind: string
  status: string
  sourceUrl: string
  sourceText: string
  sourceMeta: string
  source: string
  externalId: string | null
  vaultSha: string
  filePath: string
  updatedAt: string
  backlinks: { id: string; title: string; slug: string }[]
  unresolved: string[]
  entityRef: string | null
  skills: { id: string; name: string; confidence: number; by: 'rule' | 'model' | 'manual' }[]
  hubs: { id: string; name: string; by: 'rule' | 'model' | 'manual' }[]
}

export type BrainHub = { id: string; name: string; slug: string; keywords: string[] }

export type BrainData = { notes: BrainNote[]; hubs: BrainHub[]; skills: [string, string][] }

export type SetParams = (next: Record<string, string | null>) => void

/** A book or an article is finished by being here (decision 2026-09-11). */
export const isFinished = (n: BrainNote) =>
  n.status === 'published' && (n.kind === 'book' || n.kind === 'article')

export function Brain({ data }: { data: BrainData }) {
  const { params, set: setParams } = useSearchState()
  const toast = useToast()
  const [, start] = useTransition()

  const folder = params.get('folder') ?? 'inbox'
  const ingestOpen = params.get('ingest') === '1'
  // `hub=new` opens an empty form; `hub=<slug>` edits that hub.
  const hubParam = params.get('hub')
  const hubEditing = hubParam ? (data.hubs.find((h) => h.slug === hubParam) ?? null) : null
  const hubOpen = hubParam === 'new' || hubEditing !== null

  const run = (action: () => Promise<ActionResult>, ok?: string) =>
    start(async () => {
      const result = await action()
      if (!result.ok) toast(result.error)
      else if (ok) toast(ok)
    })

  const notes = [...data.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const drafts = notes.filter((n) => n.status === 'draft')
  const published = notes.filter((n) => n.status === 'published')
  const reading = notes.filter((n) => n.kind === 'article' || n.kind === 'book')

  // A hub is a grouping across folders, and Unfiled is what no hub has claimed.
  const hubFolder = folder.startsWith('hub:') ? data.hubs.find((h) => h.slug === folder.slice(4)) : undefined
  const shown =
    folder === 'inbox'
      ? drafts
      : folder === 'reading'
        ? reading
        : folder === 'unfiled'
          ? published.filter((n) => n.hubs.length === 0)
          : hubFolder
            ? published.filter((n) => n.hubs.some((h) => h.id === hubFolder.id))
            : published.filter((n) => n.kind === folder)

  // The note in the URL wherever it lives, else the first row: the artboard
  // never shows an empty pane while the list has something in it.
  // ponytail: a note outside the 200 listed opens nothing rather than the
  // wrong one; load it by id if a link to an old note ever needs to land.
  const asked = params.get('note')
  const open = asked ? (notes.find((n) => n.slug === asked || n.id === asked) ?? null) : (shown[0] ?? null)

  const name =
    folder === 'unfiled' ? 'Unfiled' : hubFolder ? hubFolder.name : folder.startsWith('hub:') ? 'No such hub' : folderLabel(folder)
  const crumb = folder === 'inbox' ? 'Inbox' : folder === 'reading' ? 'Reading list' : name
  const listTitle = folder === 'inbox' ? 'Inbox · drafts' : folder === 'reading' ? 'Reading list' : name
  const listMeta =
    folder === 'inbox'
      ? `${shown.length} awaiting`
      : folder === 'reading'
        ? `${shown.filter(isFinished).length} finished`
        : `${shown.length} ${shown.length === 1 ? 'note' : 'notes'}`

  const folders: { id: string; label: string; count: number }[] = [
    { id: 'inbox', label: 'Inbox', count: drafts.length },
    { id: 'reading', label: 'Reading list', count: reading.length },
    ...KINDS.map((k) => ({
      id: k,
      label: folderLabel(k),
      count: published.filter((n) => n.kind === k).length,
    })),
  ]

  return (
    <>
      <header className="-mx-[18px] flex min-h-14 flex-wrap items-center gap-4 border-b border-separator px-[18px] py-2 first:-mt-[max(18px,calc(var(--inset-t)+16px))] first:pt-[calc(16px+var(--inset-t))] md:-mx-7 md:first:-mt-7 md:px-7 lg:h-14 lg:flex-nowrap lg:py-0">
        <BackControl />
        <span className="eyebrow shrink-0 whitespace-nowrap text-secondary-label">
          Second Brain <span className="text-secondary-label">/</span> {crumb}
        </span>
        <div className="flex flex-[1_0_auto] items-center justify-end gap-4 md:min-w-0 md:flex-[1_1_0%]">
          <SearchButton className="md:hidden" />
          <BandSearch className="hidden min-w-[220px] flex-1 md:flex" placeholder="Search second brain" />
          <span className="eyebrow hidden shrink-0 whitespace-nowrap text-secondary-label md:inline-flex">
            <span className="status-dot" aria-hidden />
            {published.length} notes
          </span>
          <ActionButton
            variant="solid"
            onClick={() => setParams({ ingest: '1' }, { push: true })}
          >
            Ingest <span aria-hidden="true">&rarr;</span>
          </ActionButton>
        </div>
      </header>

      {/* One filter band: the folder row, Inbox and Reading list ahead of the
        * seven folders, then the hubs under a hairline. Both are the shared
        * pill group, so selected reads the same as on every other screen. */}
      <div className="-mx-[18px] border-b border-separator bg-grouped-2 px-5 md:-mx-7">
        <div data-testid="brain-folders" className="flex flex-wrap items-center gap-3 py-2.5">
          <PillGroup
            label="Folder"
            value={folder}
            onChange={(id) => setParams({ folder: id === 'inbox' ? null : id, note: null })}
            options={folders.map((f) => ({ value: f.id, label: f.label, count: f.count }))}
          />
          <span className="ml-auto hidden whitespace-nowrap text-caption-1 text-secondary-label md:inline">
            Vault in git is the source of truth
          </span>
        </div>
        {/* Hubs: the owner's own groupings, one note in as many as fit. */}
        <div data-testid="brain-hubs" className="flex flex-wrap items-center gap-3 border-t border-separator py-2.5">
          <PillGroup
            label="Hub"
            value={folder}
            onChange={(id) => setParams({ folder: id, note: null })}
            options={[
              // Counted over published notes, the same rows the folder lists.
              ...data.hubs.map((h) => ({
                value: `hub:${h.slug}`,
                label: h.name,
                count: published.filter((n) => n.hubs.some((x) => x.id === h.id)).length,
              })),
              { value: 'unfiled', label: 'Unfiled', count: published.filter((n) => n.hubs.length === 0).length },
            ]}
          />
          <ActionButton size="pill" variant="quiet" onClick={() => setParams({ hub: 'new' }, { push: true })}>
            + Hub
          </ActionButton>
        </div>
      </div>

      <div className="-mx-[18px] -mb-[18px] flex flex-wrap items-stretch md:-mx-7 md:-mb-7 md:min-h-[calc(100dvh-106px)]">
        <section className="flex min-w-0 flex-[1_1_280px] flex-col border-b border-separator lg:max-w-[380px] lg:border-b-0 lg:border-r">
          <div className="flex items-baseline justify-between gap-2.5 border-b border-separator px-4 pb-2.5 pt-3.5">
            <span className="truncate text-headline text-label">{listTitle}</span>
            <span className="num whitespace-nowrap text-caption-1 text-secondary-label">
              {listMeta}
              {hubFolder && (
                <ActionButton
                  variant="quiet"
                  size="sm"
                  className="ml-2.5"
                  onClick={() => setParams({ hub: hubFolder.slug }, { push: true })}
                >
                  Edit hub
                </ActionButton>
              )}
            </span>
          </div>
          <CaptureBox notes={notes} setParams={setParams} />
          {shown.length === 0 ? (
            <p className="px-4 py-6 text-footnote text-secondary-label">
              {folder === 'inbox' ? 'Inbox clear. Ingest something to draft a note.' : 'Nothing here'}
            </p>
          ) : (
            shown.map((n) => {
              const selected = open?.id === n.id
              return (
                // The row shape from Row.tsx: title, one meta line, the marks
                // under; an inset hairline between rows, the soft fill when
                // selected. A button rather than Row because the whole row is
                // the click and the list has no expander.
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setParams({ note: n.slug })}
                  className={cn(
                    'relative block w-full px-4 py-2.5 text-left transition-colors duration-150 ease-[var(--ease)] hover:bg-fill-3',
                    'before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-separator first:before:hidden',
                    selected && 'bg-grouped-2 ring-2 ring-inset ring-accent before:hidden [&+*]:before:hidden',
                  )}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-body text-label">{n.title}</span>
                    <span className="flex shrink-0 items-baseline gap-2">
                      <span className="num text-caption-1 text-secondary-label">{ago(n.updatedAt)}</span>
                      <span aria-hidden="true" className={CHEVRON}>
                        &rsaquo;
                      </span>
                    </span>
                  </span>
                  <span className="text-caption-1 mt-0.5 block truncate text-secondary-label">{subLine(n)}</span>
                  <span className="mt-1.5 flex items-center gap-1.5">
                    <span className="label text-secondary-label">{n.kind}</span>
                    {n.status === 'draft' && <StatusChip tone="warn">Draft</StatusChip>}
                    {isFinished(n) && (
                      <StatusChip tone="ok">Finished · {finishedOn(n.updatedAt)}</StatusChip>
                    )}
                  </span>
                </button>
              )
            })
          )}
        </section>

        <section className="flex min-w-0 flex-[3_1_300px] flex-col">
          {open ? (
            <NotePane key={open.id} note={open} hubs={data.hubs} skills={data.skills} setParams={setParams} run={run} />
          ) : (
            <p className="flex flex-1 items-center justify-center py-16 text-footnote text-secondary-label">
              Select a note
            </p>
          )}
        </section>
      </div>

      {ingestOpen && <IngestDrawer setParams={setParams} />}
      {hubOpen && <HubDrawer key={hubParam} hub={hubEditing} setParams={setParams} />}
    </>
  )
}
