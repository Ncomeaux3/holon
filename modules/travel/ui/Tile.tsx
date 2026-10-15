import type { TravelDigest } from '../jobs/nightly-digest'

// The Travel dashboard tile. The next trip and how far away it is, which is
// the only travel question worth asking most mornings.

export function TravelTile({ payload }: { payload: Record<string, unknown> }) {
  const d = payload as Partial<TravelDigest>
  const next = d.next ?? null

  if (!next) {
    return (
      <div className="space-y-2">
        <p className="text-subheadline text-secondary-label">Nothing booked.</p>
        <p className="num text-caption-1 text-secondary-label">
          {d.placesVisited ?? 0} places · {d.countries ?? 0} countries
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div>
        <span className="block text-caption-1 text-secondary-label">Next trip</span>
        <span className="mt-1.5 block text-body text-label">{next.destination}</span>
        <span className="num text-caption-1 text-secondary-label">
          {next.name} · {next.daysAway} days away
        </span>
      </div>
      <p className="num text-caption-1 text-secondary-label">
        {d.pending ? `${d.pending} bookings waiting · ` : ''}
        {d.placesVisited ?? 0} places · {d.countries ?? 0} countries
      </p>
    </div>
  )
}
