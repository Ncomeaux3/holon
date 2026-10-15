// Suggest week. No imports and no model: the empty slots of a week filled from
// the library by the slot's own tag, favourites first, rotating so a week is
// not seven of the same breakfast.

export type Slot = { on_date: string; slot: string }

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack']

export function fillWeek(
  empty: Slot[],
  recipes: { id: string; tags: string[]; favourite: boolean }[],
): (Slot & { recipe_id: string })[] {
  const picks: (Slot & { recipe_id: string })[] = []

  for (const { on_date, slot } of empty) {
    const tagged = recipes.filter((r) => r.tags.includes(slot))
    const pool = [...tagged.filter((r) => r.favourite), ...tagged.filter((r) => !r.favourite)]
    if (pool.length === 0) continue

    // Days since the epoch plus the slot's position: the same week always
    // fills the same way, and neighbouring slots get neighbouring recipes.
    const day = Math.floor(Date.parse(`${on_date}T00:00:00Z`) / 86_400_000)
    picks.push({ on_date, slot, recipe_id: pool[(day + SLOTS.indexOf(slot)) % pool.length].id })
  }

  return picks
}
