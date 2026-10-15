// The rule vocabulary: the shape of a rule and every function that derives
// something from one. No imports at all, deliberately.
//
// The Notifications screen is a client component and imports this. Anything
// here that reached core/db.ts would drag `pg` into the browser bundle, which
// Turbopack reports as a missing 'dns' module rather than as an import error.
// The queries live in core/notify.ts, which is server only.

export type Channel = 'push' | 'email' | 'inapp'
export type Timing = 'immediate' | 'morning' | 'evening'

export type Rule = {
  id: string
  module: string
  key: string
  label: string
  trigger_text: string
  channels: Channel[]
  timing: Timing
  lead_days: number
  urgent: boolean
  muted: boolean
  snooze_until: Date | null
  sample_title: string
  sample_body: string
  position: number
}

/**
 * Live means it would actually fire right now. Paused is global and beats
 * everything; muted is indefinite; a snooze that has passed is no snooze.
 */
export function isLive(rule: Rule, paused: boolean): boolean {
  if (paused || rule.muted) return false
  return rule.snooze_until === null || rule.snooze_until <= new Date()
}

export type RuleState =
  | { label: 'Paused' | 'Muted'; tone: 'muted' }
  | { label: 'On'; tone: 'on' }
  | { label: string; tone: 'snoozed' }

export function ruleState(rule: Rule, paused: boolean): RuleState {
  if (paused) return { label: 'Paused', tone: 'muted' }
  if (rule.muted) return { label: 'Muted', tone: 'muted' }
  if (rule.snooze_until && rule.snooze_until > new Date()) {
    const days = Math.max(1, Math.ceil((rule.snooze_until.getTime() - Date.now()) / 86_400_000))
    return { label: `${days}d`, tone: 'snoozed' }
  }
  return { label: 'On', tone: 'on' }
}

/** "None", "30m", "1 day", "14 days". The design's own vocabulary. */
export function leadLabel(days: number): string {
  if (days === 0) return 'None'
  if (days < 1) return `${Math.round(days * 60)}m`
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

/**
 * The lead times offered per module. A policy renewal is worth thirty days of
 * warning and a task reminder is worth fifteen minutes, so one list would be
 * wrong for both.
 */
export function leadOptions(module: string): number[] {
  if (module === 'insurance') return [0, 7, 14, 30, 60]
  if (module === 'travel') return [0, 0.5, 1, 2, 3]
  if (module === 'tasks') return [0, 0.25, 0.5, 1, 24]
  return [0, 1, 3, 7, 14]
}

export type RulePatch = Partial<
  Pick<Rule, 'channels' | 'timing' | 'lead_days' | 'urgent' | 'muted' | 'snooze_until'>
>
