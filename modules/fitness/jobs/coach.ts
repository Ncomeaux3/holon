import { db } from '@/core/db'
import { callTool } from '@/core/tools'
import { activePlan, stalledLifts } from '../data'
import { review, type Suggestion } from '../coach'
import { nightlyDigest } from './nightly-digest'

// The coaching agent from SPEC section 3, held to its own sentence: proposals
// only, the owner approves. It has no unguarded path to a plan. Every
// suggestion goes through the guarded write_plan tool as an agent, which means
// core.proposals and the Review inbox.

/** A suggestion already waiting is not worth saying again. */
const REPEAT_WINDOW_DAYS = 14

export type CoachRun = {
  suggestions: Suggestion[]
  proposed: number
  /** Suggestions skipped because the same one is already in the inbox. */
  alreadyWaiting: number
}

export async function coachReview(): Promise<CoachRun> {
  const [digest, plan] = await Promise.all([nightlyDigest(), activePlan()])
  const stalled = plan ? await stalledLifts() : []

  const suggestions = review({
    loadThisWeek: digest.loadThisWeek,
    loadLastWeek: digest.loadLastWeek,
    daysSinceLast: digest.daysSinceLast,
    workoutsThisWeek: digest.workoutsThisWeek,
    // No plan means no target to fall short of, and the rules say nothing
    // about a week that was never planned.
    daysPerWeek: plan?.days_per_week ?? 0,
    stalled,
  })

  if (!plan || suggestions.length === 0) {
    return { suggestions, proposed: 0, alreadyWaiting: 0 }
  }

  let proposed = 0
  let alreadyWaiting = 0

  for (const suggestion of suggestions) {
    if (await waiting(suggestion.headline)) {
      alreadyWaiting++
      continue
    }

    await callTool(
      'fitness',
      'write_plan',
      {
        id: plan.id,
        notes: [plan.notes, `${suggestion.headline}. ${suggestion.reason}`]
          .filter(Boolean)
          .join('\n\n'),
        // The plan's shape is not touched. The coach writes down what it thinks
        // and why; changing sets and reps on someone's behalf is a bigger claim
        // than a weekly rule is entitled to make, even behind an approval.
        days_per_week: plan.days_per_week,
      },
      {
        source: 'agent',
        agent: 'fitness.coach',
        title: suggestion.headline,
        reason: suggestion.reason,
        affects: 'Fitness',
        diff: [
          {
            field: 'notes',
            before: plan.notes || null,
            after: `${suggestion.headline}. ${suggestion.reason}`,
          },
        ],
      },
    )
    proposed++
  }

  return { suggestions, proposed, alreadyWaiting }
}

async function waiting(headline: string): Promise<boolean> {
  const { rows } = await db().query<{ n: string }>(
    `select count(*)::text as n from core.proposals
      where module = 'fitness' and status = 'pending'
        and title = $1
        and created_at > now() - ($2::int || ' days')::interval`,
    [headline, REPEAT_WINDOW_DAYS],
  )
  return Number(rows[0].n) > 0
}
