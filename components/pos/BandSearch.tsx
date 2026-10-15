'use client'

import { cn } from '@/lib/utils'

/**
 * The search box in the page band. A button dressed as an input, because the
 * command palette already owns the query and a second real input would let a
 * half typed search exist in two places at once. Clicking it opens the palette,
 * which is the same thing Cmd K does.
 */
export function BandSearch({
  className,
  placeholder = 'What are you looking for?',
}: {
  className?: string
  /** PosSearch's scoped placeholder on a module screen: "Search finance". */
  placeholder?: string
}) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event('pos:search'))}
      className={cn(
        'flex h-11 w-full max-w-[320px] items-center gap-2.5 rounded-capsule bg-fill-3 pl-3.5 pr-3 text-left text-label/70 transition-colors duration-150 hover:text-label focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring)',
        className,
      )}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden className="shrink-0">
        <circle cx="7" cy="7" r="4.6" />
        <path d="M10.5 10.5 L14.5 14.5" />
      </svg>
      <span className="truncate text-footnote">{placeholder}</span>
    </button>
  )
}

/**
 * The same thing as a 44px square, for the phone band.
 *
 * The artboard's header has no room for a field: it carries a search icon
 * beside the title at a 44px touch target, and the query itself belongs to the
 * palette either way, so this asks for the palette through the same event.
 */
export function SearchButton({ className, href }: { className?: string; href?: string }) {
  const shape = cn(
    'glass-regular grid size-11 shrink-0 place-items-center rounded-capsule text-label transition-colors duration-150 hover:text-label/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring)',
    className,
  )
  const glyph = (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden>
      <circle cx="7" cy="7" r="4.6" />
      <path d="M10.5 10.5 L14.5 14.5" />
    </svg>
  )

  // A link where the page's own search is a form that works without
  // javascript, so shrinking it to an icon does not quietly make it need any.
  return href ? (
    <a href={href} aria-label="Search" className={shape}>
      {glyph}
    </a>
  ) : (
    <button
      type="button"
      aria-label="Search"
      onClick={() => window.dispatchEvent(new Event('pos:search'))}
      className={shape}
    >
      {glyph}
    </button>
  )
}
