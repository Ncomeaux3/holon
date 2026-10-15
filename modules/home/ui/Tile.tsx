import type { HomeDigest } from '../jobs/nightly-digest'

// The Home dashboard tile. What needs doing, not what things are worth: the
// valuation is the owner's own number and does not change most mornings.

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`

export function HomeTile({ payload }: { payload: Record<string, unknown> }) {
  const d = payload as Partial<HomeDigest>
  const due = d.dueNow ?? []
  const warranties = d.warrantiesExpiring ?? []

  if (due.length === 0 && warranties.length === 0) {
    return <p className="text-subheadline text-secondary-label">No maintenance is due and no cover is running out.</p>
  }

  return (
    <div className="space-y-2.5">
      {due.slice(0, 3).map((j) => (
        <div key={`${j.asset}-${j.title}`} className="flex items-baseline justify-between gap-3">
          <span className="truncate text-body text-label">
            {j.title} <span className="text-secondary-label">{j.asset}</span>
          </span>
          <span className="num shrink-0 text-caption-1 text-orange-text">{j.when}</span>
        </div>
      ))}
      {warranties.length > 0 && (
        <p className="num text-caption-1 text-secondary-label">
          {warranties.length} {warranties.length === 1 ? 'warranty' : 'warranties'} expiring
        </p>
      )}
      {d.yearEstimateCents ? (
        <p className="num text-caption-1 text-secondary-label">{money(d.yearEstimateCents)} estimated this year</p>
      ) : null}
    </div>
  )
}
