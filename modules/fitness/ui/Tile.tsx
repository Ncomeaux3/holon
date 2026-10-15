import type { FitnessDigest } from '../jobs/nightly-digest'

// The Fitness dashboard tile. Load against last week is the number that says
// whether the week is going anywhere, so it leads.

export function FitnessTile({ payload }: { payload: Record<string, unknown> }) {
  const d = payload as Partial<FitnessDigest>
  const load = d.loadThisWeek ?? 0
  const last = d.loadLastWeek ?? 0
  const change = last > 0 ? Math.round(((load - last) / last) * 100) : null

  return (
    <div className="space-y-3">
      <div>
        <span className="block text-caption-1 text-secondary-label">Load this week</span>
        <span className="num mt-1.5 block text-title-2 font-semibold text-label">{load}</span>
        {change !== null && (
          <span className={`num mt-1.5 block text-caption-1 ${change >= 0 ? 'text-green-text' : 'text-secondary-label'}`}>
            {change >= 0 ? '+' : ''}
            {change}% on last week
          </span>
        )}
      </div>
      <p className="num text-caption-1 text-secondary-label">
        {d.workoutsThisWeek ?? 0} workouts · {d.minutesThisWeek ?? 0} min
        {d.daysSinceLast !== null && d.daysSinceLast !== undefined
          ? ` · ${d.daysSinceLast}d since the last`
          : ''}
      </p>
    </div>
  )
}
