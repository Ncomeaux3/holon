import type { HealthDigest } from '../jobs/nightly-digest'

// The Health dashboard tile. Appointments and anything overdue, because those
// are the two things that need a person rather than a number.

export function HealthTile({ payload }: { payload: Record<string, unknown> }) {
  const d = payload as Partial<HealthDigest>
  const upcoming = d.upcoming ?? []
  const screenings = d.screeningsDue ?? []
  const refills = d.refillsDue ?? []

  if (upcoming.length === 0 && screenings.length === 0 && refills.length === 0) {
    return <p className="text-footnote text-secondary-label">Nothing booked and nothing overdue.</p>
  }

  return (
    <div className="space-y-2.5">
      {upcoming.slice(0, 2).map((a) => (
        <div key={a.what} className="flex items-baseline justify-between gap-3">
          <span className="truncate text-subheadline text-label">{a.what}</span>
          <span className="num shrink-0 text-caption-1 text-secondary-label">
            {a.startsAt.slice(0, 10)}
          </span>
        </div>
      ))}
      {screenings.slice(0, 2).map((s) => (
        <div key={s.name} className="flex items-baseline justify-between gap-3">
          <span className="truncate text-subheadline text-label">{s.name}</span>
          <span className="shrink-0 text-caption-1 text-orange-text">{s.status}</span>
        </div>
      ))}
      {refills.length > 0 && (
        <p className="num text-caption-1 text-secondary-label">
          {refills.length} {refills.length === 1 ? 'refill' : 'refills'} due
        </p>
      )}
    </div>
  )
}
