// What the coach suggests, and why. No imports: the Fitness screen is a client
// component and anything reaching core/db.ts drags pg into the browser bundle.
//
// Deterministic rules, not a model call. "You jumped fifty percent in a week,
// back off" is not a judgement worth paying for, and it is not one that should
// come out differently on two Sundays with the same numbers. Rules first is the
// repo rule; here the model has nothing to add at all.
//
// Nothing in this file changes a plan. It returns sentences. The job hands them
// to a guarded tool, which means the Review inbox, which means the owner.

export type CoachInput = {
  /** The crude load figure from units.ts, this week and last. */
  loadThisWeek: number
  loadLastWeek: number
  /** Null when there has never been a workout at all. */
  daysSinceLast: number | null
  workoutsThisWeek: number
  /** What the active plan asks for. Zero when there is no plan. */
  daysPerWeek: number
  /** Lifts with no personal best in this many recent sessions. */
  stalled: { exercise: string; sessions: number }[]
}

export type Suggestion = {
  kind: 'restart' | 'deload' | 'add-session' | 'progress'
  headline: string
  /** The sentence that produced it, with the numbers in it. */
  reason: string
}

/** Away this long and coming back at the old volume is how people get hurt. */
const LAYOFF_DAYS = 10

/** A week over week jump this big is where injuries come from. */
const SPIKE = 1.5

/** And a drop this big is a week that got away, not a deliberate easy one. */
const SLUMP = 0.7

/** No personal best in this many sessions on one lift is a stall, not a bad day. */
const STALL_SESSIONS = 3

/**
 * What the coach would say this week. Often nothing.
 *
 * An empty list is the common and correct answer: a coach that proposes
 * something every single week is noise, and noise in the Review inbox is how
 * an inbox stops being read. Ordered most urgent first.
 */
export function review(input: CoachInput): Suggestion[] {
  const out: Suggestion[] = []

  if (input.daysSinceLast !== null && input.daysSinceLast >= LAYOFF_DAYS) {
    out.push({
      kind: 'restart',
      headline: 'Come back at half volume for one week',
      reason: `${input.daysSinceLast} days since the last workout. Picking up where you left off after a layoff that long is the thing that turns a break into an injury.`,
    })
    // Nothing else is worth saying to someone who has not trained in a
    // fortnight. Progression and stalls are questions for a week that happened.
    return out
  }

  if (input.loadLastWeek > 0 && input.loadThisWeek >= input.loadLastWeek * SPIKE) {
    out.push({
      kind: 'deload',
      headline: 'Hold volume where it is next week',
      reason: `Load went from ${input.loadLastWeek} to ${input.loadThisWeek}, a jump of ${percent(input.loadThisWeek / input.loadLastWeek - 1)}. Repeating that two weeks running is where the wheels come off.`,
    })
  }

  for (const lift of input.stalled) {
    if (lift.sessions >= STALL_SESSIONS) {
      out.push({
        kind: 'deload',
        headline: `Drop ${lift.exercise} ten percent and build back`,
        reason: `No personal best on ${lift.exercise} in ${lift.sessions} sessions. Backing off and running it up again beats grinding the same weight a fourth time.`,
      })
    }
  }

  if (
    input.daysPerWeek > 0 &&
    input.workoutsThisWeek < input.daysPerWeek &&
    input.loadLastWeek > 0 &&
    input.loadThisWeek <= input.loadLastWeek * SLUMP
  ) {
    out.push({
      kind: 'add-session',
      headline: 'One more session next week',
      reason: `${input.workoutsThisWeek} of ${input.daysPerWeek} planned sessions, and load fell ${percent(1 - input.loadThisWeek / input.loadLastWeek)}. Adding one back is a smaller ask than restarting the plan.`,
    })
  }

  if (
    out.length === 0 &&
    input.daysPerWeek > 0 &&
    input.workoutsThisWeek >= input.daysPerWeek &&
    input.loadThisWeek >= input.loadLastWeek
  ) {
    out.push({
      kind: 'progress',
      headline: 'Add a little weight where the last set felt easy',
      reason: `${input.workoutsThisWeek} of ${input.daysPerWeek} sessions and load held at ${input.loadThisWeek}. A week that went to plan is the week to add to it.`,
    })
  }

  return out
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)} percent`
}
