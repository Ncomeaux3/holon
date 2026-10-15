import type { InsuranceDigest } from '../jobs/nightly-digest'

// The Insurance dashboard tile. What is running out. This module has an
// opinion about nothing else, deliberately.

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`

export function InsuranceTile({ payload }: { payload: Record<string, unknown> }) {
  const d = payload as Partial<InsuranceDigest>
  const expiring = d.expiring ?? []

  return (
    <div className="space-y-2.5">
      {expiring.length === 0 ? (
        <p className="text-subheadline text-secondary-label">Nothing expires in the next sixty days.</p>
      ) : (
        expiring.slice(0, 3).map((p) => (
          <div key={p.name} className="flex items-baseline justify-between gap-3">
            <span className="truncate text-body text-label">
              {p.name} <span className="text-secondary-label">{p.carrier}</span>
            </span>
            <span className="num shrink-0 text-caption-1 text-orange-text">{p.when}</span>
          </div>
        ))
      )}
      <p className="num text-caption-1 text-secondary-label">
        {d.active ?? 0} active
        {d.annualCents ? ` · ${money(d.annualCents)} a year` : ''}
      </p>
    </div>
  )
}
