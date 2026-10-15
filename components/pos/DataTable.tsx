import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The column headed table: Insurance, Finance accounts and upcoming, Home,
 * Health, Meals and Travel all draw one. One opaque surface with a label row
 * and inset hairlines between rows.
 *
 * Grid rather than <table>, and the template only applies from `lg` up (768
 * gave five columns about 700px and truncated every name). Below
 * that the first cell (usually the date or the name) and the last (usually the
 * amount) share one line and the cells between wrap under, which keeps the
 * design rule that a row has to reflow at 300px.
 */
export function DataTable({
  head,
  cols,
  children,
  className,
}: {
  /** One label per column. An empty string leaves a gutter unlabelled. */
  head: ReactNode[]
  /** A grid-template-columns value, applied from md up. */
  cols: string
  children: ReactNode
  className?: string
}) {
  return (
    <div
      style={{ ['--cols' as string]: cols }}
      className={cn('w-full overflow-hidden rounded-card bg-grouped-2', className)}
    >
      {/* No table/row/columnheader roles: they only mean anything inside a
          real table role, and half a table's ARIA is worse than none. The
          header is a visual key, and each row below is a button when it opens
          something, which is the thing a reader actually needs to operate. */}
      <div
        aria-hidden
        data-table-head
        className="hidden border-b border-separator px-4 pb-2 pt-3 lg:grid lg:grid-cols-[var(--cols)] lg:gap-x-4"
      >
        {head.map((h, i) => (
          <span key={i} className="label text-secondary-label">
            {h}
          </span>
        ))}
      </div>
      {children}
    </div>
  )
}

/**
 * One row of a DataTable. Cells are the children, in column order.
 *
 * A selected row takes the accent border and the soft fill, never opacity, and
 * a muted one drops to ink-3 at full opacity so its text and any button inside
 * stay readable.
 */
export function DataRow({
  children,
  selected,
  onClick,
  className,
  style,
}: {
  children: ReactNode
  selected?: boolean
  onClick?: () => void
  className?: string
  style?: CSSProperties
}) {
  const interactive = Boolean(onClick)

  return (
    <div
      role={interactive ? 'button' : undefined}
      onClick={onClick}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
      style={style}
      className={cn(
        'relative px-4 py-3 transition-colors duration-150 ease-[var(--ease)]',
        'before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-separator first:before:hidden [[data-table-head]+&]:before:hidden',
        // Phone: first and last cells share the top line, the rest wrap under.
        'max-lg:grid max-lg:grid-cols-[auto_minmax(0,1fr)_auto] max-lg:gap-x-3 max-lg:gap-y-1',
        'max-lg:[&>*:first-child]:col-start-1 max-lg:[&>*:first-child]:row-start-1',
        'max-lg:[&>*:last-child]:col-start-3 max-lg:[&>*:last-child]:row-start-1 max-lg:[&>*:last-child]:text-right',
        'max-lg:[&>*:not(:first-child):not(:last-child)]:col-start-2',
        'lg:grid lg:grid-cols-[var(--cols)] lg:items-center lg:gap-x-4',
        // The same sunken tint as Row (v1.2 phase 3d); no chevron, since the
        // grid's columns belong to the caller's template.
        interactive && 'cursor-pointer hover:bg-fill-4',
        selected && 'ring-2 ring-inset ring-accent before:hidden [&+*]:before:hidden',
        className,
      )}
    >
      {children}
    </div>
  )
}
