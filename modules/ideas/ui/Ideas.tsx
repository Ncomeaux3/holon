'use client'

import { useState, useTransition } from 'react'
import { Card, Chip, StatusChip, TabBar, useToast, type ChipTone, type SkillLink } from '@/components/pos'
import { actionButtonBase, actionButtonSizes, actionButtonVariants } from '@/components/pos/Button'
import { fieldClass } from '@/components/pos/field'
import { useSearchState } from '@/components/pos/searchState'
import { HIT } from '@/components/pos/button-classes'
import { cn } from '@/lib/utils'
import { boardScore, parseCapture, quadrant, type Level, type Quadrant } from '../quadrant'
import { mergeIdeas, saveIdea, type ActionResult } from './actions'
import { IdeaDrawer } from './IdeaDrawer'

export type Research = {
  ideaId: string
  depth: string
  status: string
  verdict: string
  confidence: number | null
  sections: { key: string; label: string; summary: string; claims: { text: string; source: string }[] }[]
  sources: { url: string; title: string; citedText: string }[]
  searches: number
  costCents: number
  detail: string
  ranOn: string
}

export type Idea = {
  id: string
  title: string
  pitch: string
  notes: string
  stage: string
  effort: Level
  impact: Level
  killedReason: string
  tags: string[]
  goalRef: string | null
  goalTitle: string | null
  draftTitle: string | null
  daysInStage: number
  stale: boolean
  entityRef: string | null
  skills: SkillLink[]
  related: { title: string; similarity: number }[]
}

export type IdeasData = {
  research: Research[]
  ideas: Idea[]
  goals: { id: string; title: string }[]
  skills: [string, string][]
  pair: { a_id: string; b_id: string; similarity: number } | null
}

export type Stage = 'exploring' | 'validated' | 'building' | 'killed'
export const STAGES: { key: Stage; label: string; className: string }[] = [
  { key: 'exploring', label: 'Exploring', className: 'text-label' },
  { key: 'validated', label: 'Validated', className: 'text-label' },
  { key: 'building', label: 'Building', className: 'text-label' },
  { key: 'killed', label: 'Killed', className: 'text-secondary-label' },
]

export const QUADRANT_TEXT: Record<Quadrant, string> = {
  'quick-win': 'Quick win',
  'big-bet': 'Big bet',
  filler: 'Fill-in',
  'money-pit': 'Money pit',
}
const QUADRANT_TONE: Record<Quadrant, ChipTone> = {
  'quick-win': 'ok',
  'big-bet': 'brand',
  filler: 'quiet',
  'money-pit': 'bad',
}
export const QUADRANT_BG: Record<Quadrant, string> = {
  // The -text shades: system green and red fall under 3:1 on a white card.
  'quick-win': 'bg-green-text',
  'big-bet': 'bg-accent',
  filler: 'bg-gray',
  'money-pit': 'bg-red-text',
}
export const LEVEL_TEXT: Record<Level, string> = { 1: 'Low', 2: 'Med', 3: 'High' }

// The button system's pills, as Board.tsx composes them: md for a row of
// actions, sm inline in a card or a band.
export const ghost = cn(actionButtonBase, actionButtonSizes.md, actionButtonVariants.outline)
export const ghostAccent = cn(actionButtonBase, actionButtonSizes.md, actionButtonVariants.accent)
export const mini = cn(actionButtonBase, actionButtonSizes.sm, actionButtonVariants.outline)
export const miniAccent = cn(actionButtonBase, actionButtonSizes.sm, actionButtonVariants.brand)
export const field = fieldClass

/** The artboard's 30 by 6 three-segment bar, filled to the level. */
export function LevelBar({ level, tone }: { level: Level; tone: 'brand' | 'ink' }) {
  return (
    <span className="inline-flex h-1.5 w-[30px] shrink-0 gap-[1.5px]" aria-hidden>
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={cn(
            'flex-1',
            n <= level ? (tone === 'brand' ? 'bg-accent' : 'bg-secondary-label') : 'bg-fill',
          )}
        />
      ))}
    </span>
  )
}

/** The quadrant mark: a state chip, so a colour always comes with its word. */
export function QuadrantPill({ q, className }: { q: Quadrant; className?: string }) {
  return (
    <StatusChip tone={QUADRANT_TONE[q]} className={cn('shrink-0 whitespace-nowrap', className)}>
      {QUADRANT_TEXT[q]}
    </StatusChip>
  )
}

function useParams() {
  const { params, set: setParams } = useSearchState()
  return { params, setParams }
}

/** "Ideas / Board", the band's crumb. */
export function IdeasCrumb() {
  const { params } = useParams()
  return (
    <>
      Ideas <span className="text-secondary-label">/</span> {params.get('view') === 'matrix' ? 'Matrix' : 'Board'}
    </>
  )
}

/** Board | Effort × impact, the segmented control Tasks uses for its views. */
export function ViewSwitch() {
  const { params, setParams } = useParams()
  const view = params.get('view') === 'matrix' ? 'matrix' : 'board'
  return (
    <TabBar
      label="View"
      value={view}
      onChange={(v) => setParams({ view: v === 'board' ? null : v })}
      tabs={[
        { value: 'board', label: 'Board' },
        { value: 'matrix', label: 'Effort × impact' },
      ]}
      className="shrink-0"
    />
  )
}

export function Ideas({ data }: { data: IdeasData }) {
  // View, open idea and its mode live in the URL, so a screenshot survives the
  // reload the theme switch does and an idea can be linked to.
  const { params, setParams } = useParams()
  const view = params.get('view') === 'matrix' ? 'matrix' : 'board'
  const drawer = params.get('idea')
  const open = data.ideas.find((i) => i.id === drawer) ?? null

  const [draft, setDraft] = useState('')
  const [dragging, setDragging] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [, start] = useTransition()
  const toast = useToast()

  const run = (action: () => Promise<ActionResult>, ok?: string) =>
    start(async () => {
      const result = await action()
      if (!result.ok) toast(result.error)
      else if (ok) toast(ok)
    })

  const capture = () => {
    const parsed = parseCapture(draft)
    if (!parsed.title) return
    run(() => saveIdea(parsed), `Captured. ${parsed.title}`)
    setDraft('')
  }

  const pairA = data.pair ? data.ideas.find((i) => i.id === data.pair!.a_id) : null
  const pairB = data.pair ? data.ideas.find((i) => i.id === data.pair!.b_id) : null
  const openIdea = (id: string) => setParams({ idea: id, edit: null }, { push: true })

  return (
    <div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          capture()
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Capture an idea"
          placeholder="Capture an idea… add #tags, effort:low impact:high"
          className={cn(fieldClass, 'min-w-0 flex-1 basis-[240px]')}
        />
        {/* The two buttons wrap together under the field on a phone. */}
        <div className="flex gap-2">
          <button type="submit" className={ghostAccent}>
            Add
          </button>
          <button
            type="button"
            className={ghost}
            onClick={() => {
              const parsed = parseCapture(draft)
              setParams({ idea: 'new', edit: null, title: parsed.title || null }, { push: true })
              setDraft('')
            }}
          >
            Full form
          </button>
        </div>
      </form>

      {pairA && pairB && !dismissed && (
        <Card selected className="mt-3.5 flex flex-wrap items-center justify-between gap-3.5 px-3.5 py-2.5 duration-300 animate-in fade-in">
          <div className="flex min-w-0 items-center gap-2.5">
            <StatusChip tone="brand">Agent</StatusChip>
            <span className="min-w-0 text-footnote text-secondary-label">
              Similar ideas: <span className="text-label">{pairA.title}</span> and{' '}
              <span className="text-label">{pairB.title}</span> · {Math.round(data.pair!.similarity * 100)}% overlap
            </span>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              className={miniAccent}
              onClick={() => {
                // The suggestion card leaves the moment Merge is pressed, same
                // shape as Inbox.tsx's act(): optimistic, reverted with a
                // toast on failure.
                setDismissed(true)
                start(async () => {
                  const result = await mergeIdeas(pairA.id, pairB.id)
                  if (result.ok) toast(`Merged into ${pairA.title}`)
                  else {
                    setDismissed(false)
                    toast(result.error)
                  }
                })
              }}
            >
              Merge
            </button>
            <button type="button" className={mini} onClick={() => setDismissed(true)}>
              Keep separate
            </button>
          </div>
        </Card>
      )}

      <div className="pt-[18px]">
        {view === 'matrix' ? (
          <Matrix ideas={data.ideas.filter((i) => i.stage !== 'killed')} openId={open?.id ?? null} onOpen={openIdea} />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-3.5">
            {STAGES.map((stage) => {
              const list = data.ideas
                .filter((i) => i.stage === stage.key)
                .sort((a, b) => boardScore(b) - boardScore(a) || a.daysInStage - b.daysInStage)
              return (
                <section
                  key={stage.key}
                  aria-label={stage.label}
                  className="flex min-w-0 flex-col"
                  onDragOver={(e) => {
                    if (dragging) e.preventDefault()
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    const id = e.dataTransfer.getData('text/plain')
                    setDragging(null)
                    if (!id) return
                    run(() => saveIdea({ id, stage: stage.key }), `Moved to ${stage.label}`)
                  }}
                >
                  <div className="flex items-baseline justify-between gap-3 px-1 pb-2.5">
                    <h2 className={cn('text-subheadline font-semibold', stage.className)}>{stage.label}</h2>
                    <span className="num text-footnote text-secondary-label">{list.length}</span>
                  </div>
                  <div className="flex flex-col gap-2 pt-2.5">
                    {list.map((idea) => (
                      <IdeaCard
                        key={idea.id}
                        idea={idea}
                        onOpen={() => openIdea(idea.id)}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', idea.id)
                          setDragging(idea.id)
                        }}
                        onDragEnd={() => setDragging(null)}
                      />
                    ))}
                    {list.length === 0 && (
                      <div className={cn('rounded-card border border-dashed p-[18px] text-center text-footnote text-secondary-label', dragging ? 'border-accent' : 'border-opaque-separator')}>
                        Drop here
                      </div>
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>

      {drawer !== null && (
        <IdeaDrawer
          idea={open}
          isNew={drawer === 'new'}
          editing={params.get('edit') === '1'}
          draftTitle={params.get('title') ?? ''}
          goals={data.goals}
          skills={data.skills}
          research={open ? (data.research.find((r) => r.ideaId === open.id) ?? null) : null}
          onClose={() => setParams({ idea: null, edit: null, title: null })}
          onEdit={(on) => setParams({ edit: on ? '1' : null })}
          onRun={run}
        />
      )}
    </div>
  )
}

function IdeaCard({
  idea,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  idea: Idea
  onOpen: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
}) {
  const q = quadrant(idea.effort, idea.impact)
  const killed = idea.stage === 'killed'
  return (
    <Card
      as="article"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className="lift min-w-0 cursor-grab px-3.5 py-3 active:cursor-grabbing"
    >
      <button type="button" className={cn('block text-left text-subheadline', killed ? 'text-secondary-label' : 'text-label')}>
        {idea.title}
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <QuadrantPill q={q} />
        <span className="label inline-flex items-center gap-1.5 text-caption-1 text-secondary-label" title="Impact">
          Impact <LevelBar level={idea.impact} tone="brand" />
        </span>
        <span className="label inline-flex items-center gap-1.5 text-caption-1 text-secondary-label" title="Effort">
          Effort <LevelBar level={idea.effort} tone="ink" />
        </span>
      </div>
      {(idea.pitch || (killed && idea.killedReason)) && (
        <p className="mt-1.5 line-clamp-2 text-footnote text-secondary-label">
          {killed && idea.killedReason ? `Killed: ${idea.killedReason}` : idea.pitch}
        </p>
      )}
      {(idea.tags.length > 0 || idea.skills.length > 0) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          {idea.tags.map((t) => (
            <Chip key={t} tone="quiet" className="num px-2 py-1 text-caption-1">
              #{t}
            </Chip>
          ))}
          {idea.skills.map((s) => (
            <Chip key={s.id} tone="brand" className="px-2 py-1 text-caption-1">
              {s.name}
            </Chip>
          ))}
        </div>
      )}
      <div className={cn('mt-2.5 flex justify-between text-caption-1', idea.stale ? 'text-orange-text' : 'text-secondary-label')}>
        <span>
          {idea.stale ? 'Stale · ' : ''}
          {idea.daysInStage}d in stage
        </span>
        {idea.related.length > 0 && (
          <span className="text-secondary-label">
            {idea.related.length} {idea.related.length === 1 ? 'note' : 'notes'}
          </span>
        )}
      </div>
    </Card>
  )
}

/**
 * The two by two, with every live idea placed on it.
 *
 * Effort left to right, impact bottom to top, and the four corners named for
 * what they mean. The same quadrant() the pills use decides the colour, so a
 * dot in the top left and a pill saying quick win can never disagree.
 */
function Matrix({
  ideas,
  openId,
  onOpen,
}: {
  ideas: Idea[]
  openId: string | null
  onOpen: (id: string) => void
}) {
  return (
    <div className="grid grid-cols-[28px_1fr] grid-rows-[1fr_24px] gap-1.5">
      <div className="eyebrow flex items-center justify-center text-secondary-label [writing-mode:vertical-rl] [transform:rotate(180deg)]">
        Impact →
      </div>

      <Card className="relative min-h-[420px] p-0">
        <div className="absolute inset-x-0 top-1/2 h-px bg-separator" aria-hidden />
        <div className="absolute inset-y-0 left-1/2 w-px bg-separator" aria-hidden />

        <span className="eyebrow absolute left-3 top-2.5 text-green-text">Quick wins</span>
        <span className="eyebrow absolute right-3 top-2.5 text-accent">Big bets</span>
        <span className="eyebrow absolute bottom-2.5 left-3 text-secondary-label">Fill-ins</span>
        <span className="eyebrow absolute bottom-2.5 right-3 text-red-text">Money pits</span>

        {ideas.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-footnote text-secondary-label">
            An idea needs an effort and an impact before it can sit here.
          </p>
        )}

        {ideas.map((idea, i) => {
          const q = quadrant(idea.effort, idea.impact)
          // A little scatter by position in the list, so two ideas with the
          // same scores do not sit exactly on top of each other.
          const jitter = ((i % 3) - 1) * 7
          return (
            <button
              key={idea.id}
              type="button"
              onClick={() => onOpen(idea.id)}
              title={idea.title}
              style={{
                left: `calc(${(idea.effort - 1) * 33 + 17}% + ${jitter}px)`,
                top: `calc(${(3 - idea.impact) * 33 + 17}% + ${jitter * 0.6}px)`,
              }}
              className={cn(
                // HIT grows the tap area to 44px; the later absolute wins over its relative.
                HIT,
                'absolute flex max-w-[min(220px,34%)] -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-capsule border bg-grouped-2 px-2.5 py-1.5 text-left transition-colors duration-150',
                openId === idea.id ? 'z-[2] border-accent' : 'border-opaque-separator hover:z-[3] hover:border-label',
              )}
            >
              <span aria-hidden className={cn('size-2 shrink-0', QUADRANT_BG[q])} />
              <span className="min-w-0 truncate text-caption-1 text-label">{idea.title}</span>
            </button>
          )
        })}
      </Card>

      <span />
      <div className="eyebrow text-center text-secondary-label">Effort →</div>
    </div>
  )
}
