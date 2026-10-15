'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ActionButton } from './Button'
import { BackControl } from './BackControl'
import { fieldClass } from './field'

export type ReviewStep = { key: string; name: string }

/**
 * The Weekly Review shell, measured off `POS Weekly Review.dc.html`.
 *
 * Not the WizardShell. Onboarding and this one are six step flows over one set
 * of answers, but their artboards are different shapes and only Onboarding has
 * the step rail: the review is a single 760px column centred under a full
 * width band, with the step named in the band, the progress drawn twice, and
 * no skip control.
 *
 * Layout measured off the artboard, type and colour from holon-ui:
 *   band     padding 24px 28px 18px, a separator underneath, gap 20px
 *   progress 2px full bleed, accent on separator, filled to the step
 *   column   760px wide, padding 40px 28px 44px
 *   kicker   label in accent (the one place the eyebrow is not grey)
 *   question large title, 16px under the kicker
 *   helper   subheadline in secondary-label, 14px under the question, max 600px
 *   body     30px under the helper, nav 38px under the body, dashes 26px on
 *   dashes   6 x 34x3, each centred in a 44px button: accent here, secondary-label behind,
 *            opaque-separator ahead
 */
export function ReviewShell({
  steps,
  current,
  onStep,
  week,
  weekLabel,
  kicker,
  title,
  helper,
  children,
  onBack,
  onNext,
  nextLabel = 'Continue',
  footnote,
  duration = 'Usually 8 minutes',
  themeToggle,
  schedule,
}: {
  steps: ReviewStep[]
  current: string
  onStep: (key: string) => void
  /** The ISO week number, named in the band as the design has it. */
  week: number
  /** "1 - 7 Sep 2026". Sits beside the week number in the band. */
  weekLabel: string
  kicker: ReactNode
  title: ReactNode
  helper?: ReactNode
  children: ReactNode
  onBack?: () => void
  onNext: () => void
  nextLabel?: string
  footnote?: ReactNode
  duration?: ReactNode
  themeToggle?: ReactNode
  /** The review's schedule card, above the step's kicker. */
  schedule?: ReactNode
}) {
  const index = Math.max(
    0,
    steps.findIndex((s) => s.key === current),
  )

  return (
    <div className="-m-[18px] md:-m-7">
      <header className="flex flex-wrap items-center justify-between gap-5 border-b border-separator px-[18px] md:px-7 pb-[18px] pt-6">
        {/* The artboard names the week and the step, never the page. The page
            still needs a heading, so it has one and it is not drawn. */}
        <h1 className="sr-only">Weekly review</h1>
        <BackControl />
        <div className="min-w-0">
          <span className="eyebrow text-secondary-label">
            <span className="status-dot" aria-hidden />
            Week {week} · {weekLabel}
          </span>
          <p className="mt-2.5 text-subheadline text-label">
            {steps[index]?.name} · step {index + 1} of {steps.length}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="label text-secondary-label">{duration}</span>
          {themeToggle}
        </div>
      </header>

      {/* The band's own progress: 2px, full bleed, filled to the step you are
          on. The dashes at the foot of the column are the same progress made
          clickable; this is the part you see without looking for it. */}
      <div className="h-[2px] bg-separator" aria-hidden>
        <div
          className="h-full bg-accent transition-[width] duration-300"
          style={{ width: `${Math.round(((index + 1) / steps.length) * 100)}%` }}
        />
      </div>

      <div className="flex justify-center px-[18px] md:px-7 pb-11 pt-10">
        <div className="w-full max-w-[760px]">
          {schedule}
          <p className="label text-accent">{kicker}</p>
          <h2 className="mt-4 text-pretty text-large-title text-label">
            {title}
          </h2>
          {helper && (
            <p className="mt-3.5 max-w-[600px] text-pretty text-subheadline text-secondary-label">
              {helper}
            </p>
          )}

          <div className="mt-[30px]">{children}</div>

          <div className="mt-[38px] flex flex-wrap items-center gap-3">
            {onBack && (
              <ActionButton size="lg" variant="outline" onClick={onBack}>
                Back
              </ActionButton>
            )}
            <ActionButton size="lg" variant="accent" onClick={onNext}>
              {nextLabel}
            </ActionButton>
            {/* No skip: the artboard has none. What it has instead is a line
                saying you can move on and come back, which Continue already
                does. */}
            <span className="ml-auto text-footnote text-secondary-label">
              {footnote ?? 'Answers save as you go'}
            </span>
          </div>

          {/* Six dashes, not a percentage bar. Clickable, because the steps are
              and a reader who can see where they are should be able to go
              there. */}
          <nav aria-label="Review steps" className="mt-[14px] flex flex-wrap sm:mt-[26px]">
            {steps.map((s, i) => (
              <button
                key={s.key}
                type="button"
                onClick={() => onStep(s.key)}
                aria-current={s.key === current ? 'step' : undefined}
                // Numbered, so "Close" the step and "Close the week" the
                // button are distinguishable to anyone driving by name.
                aria-label={`${String(i + 1).padStart(2, '0')} ${s.name}`}
                // The dash is drawn by the pseudo element; the button itself
                // is 44px tall so a thumb or a pointer can land on it.
                className={cn(
                  'relative h-11 w-11 before:absolute before:inset-x-[5px] before:top-1/2 before:h-[3px] before:-translate-y-1/2 before:transition-colors before:duration-150 before:content-[""]',
                  i === index ? 'before:bg-accent' : i < index ? 'before:bg-secondary-label' : 'before:bg-opaque-separator hover:before:bg-secondary-label',
                )}
              />
            ))}
          </nav>
        </div>
      </div>
    </div>
  )
}

/** The review's text field: the package field, allowed to shrink in a wrapping row. */
export const reviewField = 'min-w-0 ' + fieldClass

/**
 * The review's glance card: a caption label, a title-2 number, and a small
 * coloured line under it. Not MetricTile, which is a cell of a joined strip;
 * these are separate 170px cards with 10px between them.
 */
export function GlanceCard({
  label,
  value,
  delta,
  tone = 'brand',
}: {
  label: ReactNode
  value: ReactNode
  delta?: ReactNode
  tone?: 'brand' | 'warn' | 'bad' | 'quiet'
}) {
  return (
    <div className="bg-grouped-2 p-4 rounded-card">
      <span className="block text-caption-1 text-secondary-label">{label}</span>
      <span className="num mt-1.5 block text-title-2 font-semibold text-label">
        {value}
      </span>
      {delta && (
        <span
          className={cn(
            'mt-1.5 block text-footnote',
            tone === 'warn'
              ? 'text-orange-text'
              : tone === 'bad'
                ? 'text-red-text'
                : tone === 'quiet'
                  ? 'text-secondary-label'
                  : 'text-accent',
          )}
        >
          {delta}
        </span>
      )}
    </div>
  )
}

/** The pull quote under the glance: 2px accent rule on the left, subheadline in label. */
export function ReviewNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-5 max-w-[620px] border-l-2 border-accent py-1 pl-4 text-subheadline text-label">
      {children}
    </p>
  )
}

/**
 * A row you tick: the wins list and the backlog picker are the same object with
 * a different mark on the left. subheadline title, caption meta, and selected is
 * the inset accent ring on the opaque card.
 */
export function ReviewRow({
  mark,
  title,
  meta,
  right,
  selected,
  onClick,
  label,
}: {
  mark: ReactNode
  title: ReactNode
  meta?: ReactNode
  right?: ReactNode
  selected?: boolean
  onClick: () => void
  /** Screen reader name, since the row is a control rather than a list item. */
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      className={cn(
        'flex w-full flex-wrap items-center gap-x-3.5 gap-y-3 bg-grouped-2 px-4 py-[15px] text-left rounded-card',
        'transition-colors duration-150 active:scale-[.985]',
        selected ? 'ring-2 ring-inset ring-accent' : 'hover:ring-1 hover:ring-inset hover:ring-opaque-separator',
      )}
    >
      {mark}
      <span className="min-w-0 flex-[1_1_200px]">
        <span className="block text-subheadline text-label">{title}</span>
        {meta && (
          <span className="mt-1 block text-caption-1 text-secondary-label">{meta}</span>
        )}
      </span>
      {right}
    </button>
  )
}
