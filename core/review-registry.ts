import { recordError } from './log'
import { getModules } from './modules'
import type { ReviewCheck, ReviewDecisions, ReviewItem, ReviewWin } from './module-contract'

// What every installed module contributes to the Weekly Review, composed by
// core without core knowing what any of it means.
//
// The review names no module and reads no module schema. A module that offers
// nothing contributes nothing, and the review still closes.

export type Contribution<T> = { module: string; label: string; items: T[] }

async function gather<T>(
  pick: (r: NonNullable<ReturnType<typeof source>>) => (() => Promise<T[]>) | undefined,
): Promise<Contribution<T>[]> {
  // Every module is asked at once rather than in turn: the review page calls
  // this four times and each module answers with its own queries.
  const out = await Promise.all(
    getModules().map(async (manifest): Promise<Contribution<T> | null> => {
      const fn = manifest.review && pick(manifest.review)
      if (!fn) return null
      try {
        return { module: manifest.id, label: manifest.nav.label, items: await fn() }
      } catch (error) {
        // A module that cannot answer is left out rather than failing the whole
        // review. Its absence is visible; the reason goes to the Errors tab.
        await recordError(`review:${manifest.id}`, error)
        return null
      }
    }),
  )

  return out.filter((c) => c !== null)
}

// Only used for the type of the argument above.
const source = (m: ReturnType<typeof getModules>[number]) => m.review

export const wins = () => gather<ReviewWin>((r) => r.wins)
export const slipped = () => gather<ReviewItem>((r) => r.slipped)
export const upcoming = () => gather<ReviewItem>((r) => r.upcoming)
export const pending = () => gather<ReviewCheck>((r) => r.pending)

/**
 * Hand each module back what the owner decided about its own items.
 *
 * Best effort and per module: one module refusing does not stop the rest, and
 * what did not apply is returned so the close can say so rather than claiming
 * a week was tidied when it was not.
 */
export async function applyDecisions(
  decisions: ReviewDecisions,
): Promise<{ failed: string[] }> {
  const failed: string[] = []

  for (const manifest of getModules()) {
    if (!manifest.review?.apply) continue
    try {
      await manifest.review.apply(decisions)
    } catch (error) {
      failed.push(
        `${manifest.nav.label}: ${error instanceof Error ? error.message : 'refused the change'}`,
      )
    }
  }

  return { failed }
}
