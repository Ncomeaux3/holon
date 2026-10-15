'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ActionButton, type ActionButtonVariant } from './Button'
import { HolonLockup } from './Logo'
import { Eyebrow } from './text'

export type WizardStep = { key: string; name: string; hint?: string }

/**
 * Onboarding and the Weekly Review are the same six step shell: a clickable
 * step rail with a progress bar, a kicker over a big question over a helper
 * line, and a Back / Skip / primary footer whose label changes on the last
 * step. Built once here.
 */
export function WizardShell({
  steps,
  current,
  onStep,
  kicker,
  title,
  helper,
  children,
  onBack,
  onSkip,
  onNext,
  nextLabel = 'Continue',
  nextVariant = 'solid',
  backVariant = 'quiet',
  footnote,
  railTitle,
  railLede,
}: {
  steps: WizardStep[]
  current: string
  onStep: (key: string) => void
  kicker: ReactNode
  title: ReactNode
  helper?: ReactNode
  children: ReactNode
  onBack?: () => void
  onSkip?: () => void
  onNext: () => void
  nextLabel?: string
  /** Onboarding's artboard draws an accent primary and a bordered Back; the review's does not. */
  nextVariant?: ActionButtonVariant
  backVariant?: ActionButtonVariant
  footnote?: ReactNode
  railTitle: string
  railLede?: string
}) {
  const index = Math.max(0, steps.findIndex((s) => s.key === current))
  const pct = Math.round(((index + 1) / steps.length) * 100)

  return (
    <div className="flex min-h-dvh flex-col gap-8 p-7 lg:flex-row lg:gap-12">
      <aside className="w-full shrink-0 space-y-6 lg:w-[264px]">
        <HolonLockup size={26} />
        <div className="space-y-2">
          <h1 className="text-headline text-label">{railTitle}</h1>
          {railLede && <p className="text-footnote text-secondary-label">{railLede}</p>}
        </div>

        <div className="space-y-1">
          <div className="h-0.5 w-full bg-separator">
            <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex justify-between">
            <Eyebrow>{steps[index]?.name}</Eyebrow>
            <span className="num text-caption-1 text-secondary-label">{pct}%</span>
          </div>
        </div>

        <ol className="space-y-0.5">
          {steps.map((s, i) => {
            const done = i < index
            const on = s.key === current
            return (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => onStep(s.key)}
                  aria-current={on ? 'step' : undefined}
                  className={cn(
                    'flex min-h-11 w-full items-baseline gap-3 border-l-2 py-2.5 pl-3 pr-2 text-left transition-colors duration-150',
                    on ? 'border-accent' : 'border-transparent hover:bg-fill-4',
                  )}
                >
                  <span
                    className={cn(
                      'label w-4 shrink-0 text-caption-1',
                      done ? 'text-green-text' : on ? 'text-label' : 'text-secondary-label',
                    )}
                  >
                    {done ? '✓' : String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0">
                    <span className={cn('block text-subheadline text-label', on && 'font-semibold')}>{s.name}</span>
                    {s.hint && <span className="block text-caption-1 text-secondary-label">{s.hint}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="max-w-[64ch] space-y-3">
          <Eyebrow>{kicker}</Eyebrow>
          <h2 className="text-title-1 font-semibold text-label">
            {title}
          </h2>
          {helper && <p className="text-body text-secondary-label">{helper}</p>}
        </div>

        <div className="mt-7 min-h-0 flex-1">{children}</div>

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-separator pt-4">
          <div className="flex items-center gap-2">
            {onBack && (
              <ActionButton variant={backVariant} onClick={onBack}>
                Back
              </ActionButton>
            )}
            {onSkip && (
              <ActionButton variant="quiet" onClick={onSkip}>
                Skip for now
              </ActionButton>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {footnote && <span className="text-caption-1 text-secondary-label">{footnote}</span>}
            <ActionButton variant={nextVariant} onClick={onNext} className="px-4">
              {nextLabel}
            </ActionButton>
          </div>
        </div>
      </main>
    </div>
  )
}
