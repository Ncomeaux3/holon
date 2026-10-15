// SPEC's third digest bullet: skills with high goal weight but low activity.
// No imports, so the page and the nightly job share one rule and a test can
// hold it without a database.

export type Pressured = {
  skillId: string
  name: string
  /** Sum of weight * confidence over the skill links of goals. */
  goalWeight: number
  /** XP gained in the last 30 days. */
  gained30d: number
}

/**
 * The skills a goal points at that have not moved this month, heaviest goal
 * weight first. A skill nobody is aiming at is not under pressure however
 * quiet it is; that is what the stagnant list is for.
 */
export function underGoalPressure<T extends Pick<Pressured, 'goalWeight' | 'gained30d'>>(
  rows: T[],
  limit: number,
): T[] {
  return rows
    .filter((r) => r.goalWeight > 0 && r.gained30d <= 0)
    .sort((a, b) => b.goalWeight - a.goalWeight)
    .slice(0, limit)
}
