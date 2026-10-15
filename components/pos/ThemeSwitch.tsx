'use client'

import type { Theme } from '@/core/theme'
import { applyTheme, useTheme } from '@/core/theme-client'
import { cn } from '@/lib/utils'

const OPTIONS: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/**
 * The three-way theme control: a sunken track with the pressed option raised.
 *
 * `theme` is only the server's first-paint value; applyTheme() writes
 * <html data-theme> and the cookie directly, and useTheme() reads that
 * attribute back, so this control and any other ThemeSwitch on the page move
 * together the instant a tap lands, with no server round trip.
 */
export function ThemeSwitch({ theme, className }: { theme: Theme; className?: string }) {
  const current = useTheme(theme)

  return (
    <div
      role="group"
      aria-label="Theme"
      className={cn('flex gap-0.5 rounded-control bg-fill-3 p-0.5', className)}
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === current}
          onClick={() => o.value !== current && applyTheme(o.value)}
          className={cn(
            'h-11 flex-1 rounded-control px-2 text-footnote font-medium text-label/70 transition-colors duration-150 hover:text-label',
            o.value === current && 'bg-grouped-2 text-label shadow-lift',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
