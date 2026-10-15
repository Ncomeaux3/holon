import type { MealsDigest } from '../jobs/nightly-digest'

// The Meals dashboard tile. Gaps in the week, because an empty slot is the
// thing that needs a decision.

export function MealsTile({ payload }: { payload: Record<string, unknown> }) {
  const d = payload as Partial<MealsDigest>
  const gaps = d.gaps ?? 0

  return (
    <div className="space-y-3">
      <div>
        <span className="block text-caption-1 text-secondary-label">Gaps in the next week</span>
        <span className="num mt-1.5 block text-title-2 font-semibold text-label">{gaps}</span>
        <span className="num mt-1.5 block text-caption-1 text-secondary-label">
          {d.plannedThisWeek ?? 0} planned · {d.eatenThisWeek ?? 0} eaten
        </span>
      </div>
      {d.kcalTarget ? (
        <p className="num text-caption-1 text-secondary-label">
          {d.kcalEaten ?? 0} of {d.kcalTarget} kcal · {d.kcalStanding}
        </p>
      ) : null}
    </div>
  )
}
