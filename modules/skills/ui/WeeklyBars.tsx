'use client'

/** XP by week over 90 days. Hand rolled SVG: no chart library in this repo. */
export function WeeklyBars({ weeks }: { weeks: number[] }) {
  const max = Math.max(...weeks, 1)
  const w = 100 / weeks.length

  return (
    <div className="space-y-1">
      <svg viewBox="0 0 100 34" preserveAspectRatio="none" className="h-[64px] w-full" role="img" aria-label="XP by week over 90 days">
        {weeks.map((value, i) => {
          // Every week draws a bar, a quiet one included. A zero height rect is
          // nothing at all on screen, which left a 90 day chart showing a
          // single spike floating in an empty box with no axis under it.
          const h = Math.max(1, (value / max) * 33)
          return (
            <rect
              key={i}
              x={i * w + w * 0.15}
              y={33 - h}
              width={w * 0.7}
              height={h}
              fill={value > 0 ? 'var(--accent)' : 'var(--color-fill)'}
            />
          )
        })}
        <line x1="0" y1="33.5" x2="100" y2="33.5" stroke="var(--separator)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="eyebrow flex justify-between text-secondary-label">
        <span>&minus;90d</span>
        <span>&minus;45d</span>
        <span>now</span>
      </div>
    </div>
  )
}
