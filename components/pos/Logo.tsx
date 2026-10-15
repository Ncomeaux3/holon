import { cn } from '@/lib/utils'

// The Holon ribbon and wordmark, from holon-cobalt-sand/. The ribbon is a
// raster: the kit's colour SVGs carry gradient surfaces and weigh 280 KB, and
// the mark must not be redrawn, so the transparent optical export at 64px
// serves every size up to 32 at 2x. The wordmark is outlined text, 890 bytes
// of path, inlined so it follows the text colour in both themes.

/** The ribbon on its own. Decorative unless it is the only content of a link. */
export function HolonMark({
  size = 28,
  label,
  className,
}: {
  size?: number
  /** Set when the mark stands alone in a control; otherwise it is decorative. */
  label?: string
  className?: string
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a static brand asset, no optimisation wanted
    <img
      src="/brand/holon-optical-64.png"
      width={size}
      height={size}
      alt={label ?? ''}
      draggable={false}
      className={cn('shrink-0 select-none', className)}
    />
  )
}

/** "Holon" as outlined glyphs in the current colour. Height sets the width. */
export function HolonWordmark({ height = 20, className }: { height?: number; className?: string }) {
  return (
    <svg
      viewBox="18 28 368 114"
      height={height}
      width={Math.round(height * (368 / 114))}
      role="img"
      aria-label="Holon"
      className={cn('shrink-0 fill-current', className)}
    >
      <g transform="translate(18 142) scale(0.15)" fillRule="evenodd">
        <path d="M0 0H104V-302H482V0H586V-720H482V-401H104V-720H0Z" />
        <path transform="translate(646 0)" d="M270 -550A275 275 0 1 1 269.99 -550Z M270 -453A178 178 0 1 0 270.01 -453Z" />
        <path transform="translate(1226 0)" d="M0 0H98V-756H0Z" />
        <path transform="translate(1382 0)" d="M270 -550A275 275 0 1 1 269.99 -550Z M270 -453A178 178 0 1 0 270.01 -453Z" />
        <path
          transform="translate(1962 0)"
          d="M0 0V-302C0 -466 96 -550 247 -550C398 -550 494 -466 494 -302V0H396V-299C396 -402 343 -453 247 -453C151 -453 98 -402 98 -299V0Z"
        />
      </g>
    </svg>
  )
}

/** Ribbon plus wordmark, for sign-in and the rail. */
export function HolonLockup({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-3 text-label', className)}>
      <HolonMark size={size} />
      <HolonWordmark height={Math.round(size * 0.61)} />
    </span>
  )
}
