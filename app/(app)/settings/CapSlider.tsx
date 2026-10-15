'use client'

import { useState } from 'react'

/** The artboard's slider: 5 to 100 dollars in fives, with the bar of spend against it. */
export function CapSlider({ initialDollars, spendCents }: { initialDollars: number; spendCents: number }) {
  const [cap, setCap] = useState(Math.min(100, Math.max(5, Math.round(initialDollars / 5) * 5 || 5)))
  const pct = Math.min(100, (spendCents / 100 / cap) * 100)
  return (
    <>
      <div className="mt-3.5 flex items-center gap-3.5">
        <input
          type="range"
          name="llm_soft_cap_dollars"
          min={5}
          max={100}
          step={5}
          value={cap}
          onChange={(e) => setCap(Number(e.target.value))}
          aria-label="Cap per month"
          className="h-11 min-w-0 flex-1 accent-accent"
        />
        <span className="num w-14 text-right text-subheadline text-label">${cap}/mo</span>
      </div>
      <div className="mt-3 h-0.5 bg-fill">
        <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
    </>
  )
}
