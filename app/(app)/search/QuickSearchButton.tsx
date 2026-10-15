'use client'

/** The band's "Quick search ⌘K": asks the palette for itself, as the band search does. */
export function QuickSearchButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event('pos:search'))}
      className="inline-flex h-11 items-center whitespace-nowrap rounded-capsule bg-fill-3 px-3.5 text-footnote text-label transition-colors duration-150 hover:bg-fill-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring)"
    >
      Quick search <span className="num ml-1.5 text-caption-1 text-label/70">⌘K</span>
    </button>
  )
}
