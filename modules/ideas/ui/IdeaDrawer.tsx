'use client'

import Link from 'next/link'
import { useId, useState } from 'react'
import {
  ActionButton,
  Card,
  Chip,
  ConfirmButton,
  Eyebrow,
  Field,
  MetricStrip,
  Overlay,
  PillGroup,
  SkillPicker,
  StatusChip,
  submitOnModEnter,
  useFormErrors,
  type ChipTone,
} from '@/components/pos'
import { HIT } from '@/components/pos/button-classes'
import { cn } from '@/lib/utils'
import { quadrant, type Level } from '../quadrant'
import { deleteIdea, draftTask, researchIdea, saveIdea, type ActionResult, type IdeaInput } from './actions'
import {
  LEVEL_TEXT,
  LevelBar,
  QuadrantPill,
  STAGES,
  field,
  mini,
  miniAccent,
  type Idea,
  type Research,
  type Stage,
} from './Ideas'

// The idea drawer, as the artboard draws it: a view with the scores, the
// stage moves, the problem, the Agent card, what is linked, and Edit and
// Delete in the footer; an edit mode that is a form holding until Save. New
// idea is the form with Create. The research rubric, which the artboard
// predates, sits under the Agent card in the same box.

export function IdeaDrawer({
  idea,
  isNew,
  editing,
  draftTitle,
  goals,
  skills,
  research,
  onClose,
  onEdit,
  onRun,
}: {
  idea: Idea | null
  isNew: boolean
  editing: boolean
  /** What the capture line had when Full form was pressed. */
  draftTitle: string
  goals: { id: string; title: string }[]
  skills: [string, string][]
  research: Research | null
  onClose: () => void
  onEdit: (on: boolean) => void
  onRun: (action: () => Promise<ActionResult>, ok?: string) => void
}) {
  if (isNew || (idea && editing)) {
    return (
      <Form
        idea={isNew ? null : idea}
        draftTitle={draftTitle}
        goals={goals}
        onCancel={() => (isNew ? onClose() : onEdit(false))}
        onRun={onRun}
        onSaved={() => (isNew ? onClose() : onEdit(false))}
      />
    )
  }
  if (!idea) return null
  return <View idea={idea} skills={skills} research={research} onClose={onClose} onEdit={() => onEdit(true)} onRun={onRun} />
}

function View({
  idea,
  skills,
  research,
  onClose,
  onEdit,
  onRun,
}: {
  idea: Idea
  skills: [string, string][]
  research: Research | null
  onClose: () => void
  onEdit: () => void
  onRun: (action: () => Promise<ActionResult>, ok?: string) => void
}) {
  const q = quadrant(idea.effort, idea.impact)
  const stage = STAGES.find((s) => s.key === idea.stage) ?? STAGES[0]

  return (
    <Overlay
      open
      onClose={onClose}
      eyebrow={
        <>
          Ideas <span className="text-secondary-label">/</span> {idea.title}
        </>
      }
      footer={
        <>
          <ActionButton onClick={onEdit}>Edit</ActionButton>
          <ConfirmButton
            confirmLabel="Delete"
            title="Delete this idea?"
            message="Killing keeps it; this does not."
            onConfirm={() => {
              onRun(() => deleteIdea(idea.id), 'Deleted')
              onClose()
            }}
          >
            Delete
          </ConfirmButton>
        </>
      }
    >
      <div className="flex flex-col gap-[18px]">
        <div>
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-title-2 text-label">{idea.title}</h2>
            <QuadrantPill q={q} className="mt-1" />
          </div>
          {idea.pitch && <p className="mt-2 text-subheadline text-secondary-label">{idea.pitch}</p>}
          {idea.tags.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {idea.tags.map((t) => (
                <Chip key={t} tone="quiet" className="num">
                  #{t}
                </Chip>
              ))}
            </div>
          )}
        </div>

        <MetricStrip className="grid-cols-3 sm:grid-cols-3">
          <div className="px-3 py-2.5">
            <Eyebrow>Stage</Eyebrow>
            <div className={cn('mt-1.5 text-subheadline', stage.className)}>{stage.label}</div>
            <div className={cn('num mt-0.5 text-caption-1', idea.stale ? 'text-orange-text' : 'text-secondary-label')}>
              {idea.stale ? 'Stale · ' : ''}
              {idea.daysInStage}d in stage
            </div>
          </div>
          <div className="px-3 py-2.5">
            <Eyebrow>Impact</Eyebrow>
            <div className="mt-1.5 flex items-center gap-2 text-subheadline text-label">
              {LEVEL_TEXT[idea.impact]} <LevelBar level={idea.impact} tone="brand" />
            </div>
          </div>
          <div className="px-3 py-2.5">
            <Eyebrow>Effort</Eyebrow>
            <div className="mt-1.5 flex items-center gap-2 text-subheadline text-label">
              {LEVEL_TEXT[idea.effort]} <LevelBar level={idea.effort} tone="ink" />
            </div>
          </div>
        </MetricStrip>

        <div className="flex flex-wrap items-center gap-1.5">
          <Eyebrow className="mr-1">Move to</Eyebrow>
          {STAGES.filter((s) => s.key !== idea.stage).map((s) => (
            <button
              key={s.key}
              type="button"
              className={mini}
              onClick={() => onRun(() => saveIdea({ id: idea.id, stage: s.key }), `Moved to ${s.label}`)}
            >
              {s.label}
            </button>
          ))}
        </div>

        {(idea.notes || idea.killedReason) && (
          <div>
            <Eyebrow>{idea.stage === 'killed' && idea.killedReason ? 'Why it was killed' : "Problem · who it's for"}</Eyebrow>
            <p className="mt-2 text-footnote text-secondary-label">
              {idea.stage === 'killed' && idea.killedReason ? idea.killedReason : idea.notes}
            </p>
          </div>
        )}

        <Card className="flex flex-col gap-2.5 px-3.5 py-3">
          <div className="flex items-baseline justify-between">
            <Eyebrow className="text-accent">Agent</Eyebrow>
            <span className="text-caption-1 text-secondary-label">drafts land in Review</span>
          </div>
          <div className="flex items-center justify-between gap-2.5">
            <div className="min-w-0 text-footnote text-label">
              Validation task
              <div className="mt-0.5 text-caption-1 text-secondary-label">
                {idea.stage === 'exploring'
                  ? 'Drafts a 30-minute task to test the riskiest assumption'
                  : 'Drafts the next concrete step for this stage'}
              </div>
            </div>
            <button
              type="button"
              className={miniAccent}
              onClick={() => onRun(() => draftTask(idea.id), 'Drafted. It is waiting in Tasks / Review.')}
            >
              {idea.draftTitle ? 'Redraft' : 'Draft task'}
            </button>
          </div>
          {idea.draftTitle && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-separator pt-2.5 text-footnote text-secondary-label">
              <StatusChip tone="warn">Pending</StatusChip>
              {idea.draftTitle}{' '}
              <Link href="/tasks?view=review" className={cn(HIT, 'inline-block text-secondary-label hover:text-label')}>
                Review →
              </Link>
            </div>
          )}
        </Card>

        <ResearchCard idea={idea} run={research} onRun={(depth) => onRun(() => researchIdea(idea.id, depth), 'Researched. The card says what it found and what it cost.')} />

        <div>
          <div className="flex min-h-11 items-center justify-between">
            <Eyebrow>Linked skills</Eyebrow>
            <Link href="/skills" className="flex min-h-11 items-center text-caption-1 text-secondary-label hover:text-label">
              Skill tree →
            </Link>
          </div>
          {/* mt-3 keeps the picker's 44px hit areas off the link row above. */}
          {idea.entityRef ? (
            <SkillPicker entityRef={idea.entityRef} links={idea.skills} skills={skills} className="mt-3" />
          ) : (
            <p className="mt-2 text-footnote text-secondary-label">Nothing matched yet.</p>
          )}
        </div>

        {idea.goalTitle && idea.goalRef && (
          <div>
            <Eyebrow>Linked goal</Eyebrow>
            <Link href="/goals" className="mt-1.5 flex min-h-11 items-center text-footnote text-label hover:text-accent">
              {idea.goalTitle} →
            </Link>
          </div>
        )}

        <div>
          <div className="flex min-h-11 items-center justify-between">
            <Eyebrow>Related notes</Eyebrow>
            <Link href="/brain" className="flex min-h-11 items-center text-caption-1 text-secondary-label hover:text-label">
              Second Brain →
            </Link>
          </div>
          <div className="mt-1.5 flex flex-col">
            {idea.related.length === 0 && (
              <span className="py-1.5 text-footnote text-secondary-label">Nothing similar in the vault yet</span>
            )}
            {idea.related.map((n) => (
              <Link key={n.title} href="/brain" className="flex min-h-11 items-center justify-between gap-2.5 border-b border-separator py-2 text-footnote text-label hover:text-accent">
                <span className="min-w-0 truncate">{n.title}</span>
                <span className="num shrink-0 text-caption-1 text-secondary-label">note · {Math.round(n.similarity * 100)}%</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </Overlay>
  )
}

const VERDICT_TONE: Record<string, ChipTone> = {
  build: 'brand',
  park: 'warn',
  drop: 'bad',
  unclear: 'quiet',
}

/**
 * The rubric's answer, its sources, and what it cost.
 *
 * The cost is on the screen because the run spends real money: a cent a search
 * plus tokens, and an idea board is exactly the place where it is tempting to
 * press the button forty times.
 */
function ResearchCard({
  idea,
  run,
  onRun,
}: {
  idea: Idea
  run: Research | null
  onRun: (depth: 'quick' | 'deep') => void
}) {
  return (
    <Card className="flex flex-col gap-2.5 px-3.5 py-3">
      <div className="flex items-baseline justify-between">
        <Eyebrow>Research</Eyebrow>
        <span className="num text-caption-1 text-secondary-label">{run === null ? 'never run' : `${run.depth} · ${run.ranOn}`}</span>
      </div>

      {run === null && (
        <p className="text-footnote text-secondary-label">
          A fixed rubric with web search: problem, market, competitors, differentiation, and what one
          person nights and weekends would have to build. Every number comes with the page it came
          from, and a number without one is deleted before you see it.
        </p>
      )}

      {run?.status === 'failed' && <p className="text-footnote text-red-text">{run.detail}</p>}

      {run?.status === 'ok' && (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip tone={VERDICT_TONE[run.verdict] ?? 'quiet'}>
              {run.verdict.charAt(0).toUpperCase() + run.verdict.slice(1)}
            </StatusChip>
            <span className="num text-caption-1 text-secondary-label">
              {run.confidence === null ? 'no confidence given' : `${Math.round(run.confidence * 100)}% confident`}
            </span>
            <span className="num text-caption-1 text-secondary-label">
              {run.searches} searches, {(run.costCents / 100).toFixed(2)} dollars
            </span>
          </div>

          {run.sections.map((section) => (
            <div key={section.key} className="space-y-1">
              <Eyebrow>{section.label}</Eyebrow>
              {section.summary && <p className="text-footnote text-secondary-label">{section.summary}</p>}
              {section.claims.length === 0 && !section.summary ? (
                <p className="text-footnote text-secondary-label">Nothing it could source.</p>
              ) : (
                section.claims.map((claim) => (
                  <p key={claim.text} className="text-footnote text-secondary-label">
                    {claim.text}{' '}
                    {claim.source && (
                      <a className="text-accent" href={claim.source} target="_blank" rel="noreferrer">
                        source
                      </a>
                    )}
                  </p>
                ))
              )}
            </div>
          ))}

          {run.sources.length > 0 && (
            <div className="space-y-1 border-t border-separator pt-2">
              <Eyebrow>Pages it read</Eyebrow>
              {run.sources.map((source) => (
                <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="flex min-h-11 items-center text-footnote text-secondary-label hover:text-accent">
                  <span className="min-w-0 truncate">{source.title}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={miniAccent} onClick={() => onRun('quick')}>
          {run === null ? 'Research it' : 'Run again'}
        </button>
        <button type="button" className={mini} onClick={() => onRun('deep')}>
          Deep run
        </button>
      </div>
      <p className="text-caption-1 text-secondary-label">
        Quick is up to four searches, deep is twelve. Searches are a cent each and the pages they
        return are read as tokens, which is the larger half of the bill. Counted against the monthly
        cap in Settings, which stops research first when it runs out.
        {idea.stage === 'killed' && ' Researching something you killed is allowed; sometimes that is how it comes back.'}
      </p>
    </Card>
  )
}

const LEVELS: Level[] = [1, 2, 3]

function Segment({
  label,
  value,
  onChange,
}: {
  label: string
  value: Level
  onChange: (l: Level) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Eyebrow>{label}</Eyebrow>
      <PillGroup
        label={label}
        value={String(value)}
        onChange={(v) => onChange(Number(v) as Level)}
        options={LEVELS.map((l) => ({ value: String(l), label: LEVEL_TEXT[l] }))}
      />
    </div>
  )
}

function Form({
  idea,
  draftTitle,
  goals,
  onCancel,
  onRun,
  onSaved,
}: {
  idea: Idea | null
  draftTitle: string
  goals: { id: string; title: string }[]
  onCancel: () => void
  onRun: (action: () => Promise<ActionResult>, ok?: string) => void
  onSaved: () => void
}) {
  const initial = {
    title: idea?.title ?? draftTitle,
    pitch: idea?.pitch ?? '',
    notes: idea?.notes ?? '',
    effort: (idea?.effort ?? 2) as Level,
    impact: (idea?.impact ?? 2) as Level,
    stage: (idea?.stage ?? 'exploring') as Stage,
    goal: idea?.goalRef ?? '',
    tags: idea?.tags.join(', ') ?? '',
  }
  const [d, setD] = useState(initial)
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => d[k] !== initial[k])
  const set = (key: keyof typeof d) => (e: { target: { value: string } }) =>
    setD((prev) => ({ ...prev, [key]: e.target.value }))
  const formId = useId()
  const { errors, ref: formRef, submit } = useFormErrors(() => ({
    title: d.title.trim() ? undefined : 'Idea is required',
  }))

  const save = () => {
    if (!submit()) return
    const input: IdeaInput = {
      ...(idea && { id: idea.id }),
      title: d.title.trim(),
      pitch: d.pitch,
      notes: d.notes,
      effort: d.effort,
      impact: d.impact,
      stage: d.stage,
      goal_ref: d.goal || null,
      tags: d.tags
        .split(/[,\s]+/)
        .map((t) => t.replace(/^#/, '').toLowerCase())
        .filter(Boolean),
    }
    onRun(() => saveIdea(input), idea ? 'Saved' : `Captured. ${d.title.trim()}`)
    onSaved()
  }

  return (
    <Overlay
      open
      onClose={onCancel}
      dirty={dirty}
      eyebrow={
        <>
          Ideas <span className="text-secondary-label">/</span> {idea ? 'Edit' : 'New idea'}
        </>
      }
      footer={
        <>
          <ActionButton variant="cancel" onClick={onCancel}>
            Cancel
          </ActionButton>
          <ActionButton variant="solid" type="submit" form={formId}>
            {idea ? 'Save' : 'Create'} <span aria-hidden="true">&rarr;</span>
          </ActionButton>
        </>
      }
    >
      <form
        id={formId}
        ref={formRef}
        className="flex flex-col gap-[18px]"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Field label="Idea" required error={errors.title}>
          <input value={d.title} onChange={set('title')} placeholder="Short name" className={field} />
        </Field>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>One-line pitch</Eyebrow>
          <input value={d.pitch} onChange={set('pitch')} placeholder="What it does, in a sentence" className={field} />
        </label>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Problem · who it&apos;s for</Eyebrow>
          <textarea
            value={d.notes}
            onChange={set('notes')}
            onKeyDown={submitOnModEnter}
            rows={3}
            className={cn(field, 'resize-y leading-[1.5]')}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Segment label="Effort" value={d.effort} onChange={(effort) => setD((p) => ({ ...p, effort }))} />
          <Segment label="Impact" value={d.impact} onChange={(impact) => setD((p) => ({ ...p, impact }))} />
          <label className="flex flex-col gap-1.5">
            <Eyebrow>Stage</Eyebrow>
            <select value={d.stage} onChange={set('stage')} className={field}>
              {STAGES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <Eyebrow>Linked goal</Eyebrow>
            <select value={d.goal} onChange={set('goal')} className={field}>
              <option value="">None</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Tags</Eyebrow>
          <input value={d.tags} onChange={set('tags')} placeholder="saas, b2b, hardware" className={cn(field, 'num')} />
        </label>
        <Card className="px-3.5 py-3">
          <div className="flex items-baseline justify-between">
            <Eyebrow>Skills · linked</Eyebrow>
            <span className="text-caption-1 text-secondary-label">from title, pitch and tags · corrected on the Skill tree</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {!idea || idea.skills.length === 0 ? (
              <span className="text-footnote text-secondary-label">{idea ? 'Nothing matched yet.' : 'Classified when it is saved.'}</span>
            ) : (
              idea.skills.map((s) => (
                <Chip key={s.id} tone="brand">
                  {s.name}
                </Chip>
              ))
            )}
          </div>
        </Card>
      </form>
    </Overlay>
  )
}
