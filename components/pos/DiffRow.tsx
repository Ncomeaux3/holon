import { cn } from '@/lib/utils'

export type Diff = { field: string; before: string | null; after: string | null }

/**
 * field | before to after. The Agent Log entry body and the Review panel's
 * proposed change use the same shape, which is why it is one component.
 *
 * Undone entries swap before and after and strike the row, so the log reads
 * the same whichever direction the value last moved.
 */
export function DiffRow({ diff, undone }: { diff: Diff; undone?: boolean }) {
  // An empty string is a real prior value and has to read as one: nullish
  // coalescing alone leaves the before side blank, which looks like a render
  // bug rather than "this field was empty".
  const show = (v: string | null) => (v === null || v === '' ? 'empty' : v)
  const from = show(undone ? diff.after : diff.before)
  const to = show(undone ? diff.before : diff.after)

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-separator py-2 last:border-b-0">
      <span className="label min-w-[7rem] text-caption-1 text-label/70">
        {diff.field}
      </span>
      <span className={cn('num text-footnote text-label/70', undone && 'line-through')}>
        {from}
      </span>
      <span aria-hidden className="label text-footnote text-label/70">
        to
      </span>
      <span className={cn('num text-footnote', undone ? 'text-label/70 line-through' : 'text-label')}>
        {to}
      </span>
    </div>
  )
}

export function DiffList({ diffs, undone }: { diffs: Diff[]; undone?: boolean }) {
  if (diffs.length === 0) return null
  return (
    <div className="rounded-control border border-opaque-separator bg-fill-3 px-3 py-1">
      {diffs.map((d) => (
        <DiffRow key={d.field} diff={d} undone={undone} />
      ))}
    </div>
  )
}
