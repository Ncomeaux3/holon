import { cn } from '@/lib/utils'

/**
 * The owner's initials in a 32px accent-tint circle with a quarter-strength
 * accent ring: the tint alone is one shade off the light canvas and the
 * circle vanished. Decorative on its own: the button around it (AvatarMenu)
 * carries the accessible name.
 */
export function Avatar({ initials, className }: { initials: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-full bg-accent/8 text-footnote font-semibold leading-none text-accent ring-1 ring-inset ring-accent/25',
        className,
      )}
    >
      {initials}
    </span>
  )
}
