// Where an idea sits, and what that means. No imports: the Ideas screen is a
// client component and anything reaching core/db.ts drags pg into the browser
// bundle.

export type Level = 1 | 2 | 3

export type Quadrant = 'quick-win' | 'big-bet' | 'filler' | 'money-pit'

/**
 * The two by two, from effort and impact.
 *
 * A three point scale rather than ten, because the difference between a 6 and a
 * 7 out of ten is not a judgement anyone makes consistently, and a scale that
 * invites it produces false precision that then gets sorted on.
 *
 * The midpoint counts as low effort and high impact, which is deliberate: a
 * middling idea is worth a look before it is worth dismissing, and rounding the
 * middle towards "do it" is the bias a personal backlog should have.
 */
export function quadrant(effort: Level, impact: Level): Quadrant {
  const cheap = effort <= 2
  const worthwhile = impact >= 2

  if (cheap && worthwhile) return 'quick-win'
  if (!cheap && worthwhile) return 'big-bet'
  if (cheap) return 'filler'
  return 'money-pit'
}

export const QUADRANT_LABELS: Record<Quadrant, string> = {
  'quick-win': 'Quick win',
  'big-bet': 'Big bet',
  filler: 'Fill-in',
  'money-pit': 'Money pit',
}

/** What the label is actually telling you to do. */
export const QUADRANT_ADVICE: Record<Quadrant, string> = {
  'quick-win': 'Cheap and worth it. Do these first.',
  'big-bet': 'Worth it and expensive. Pick at most one at a time.',
  filler: 'Cheap and not worth much. Fine between the real work.',
  'money-pit': 'Expensive and not worth much. This is the one to kill.',
}

export const LEVEL_LABELS: Record<Level, string> = { 1: 'low', 2: 'medium', 3: 'high' }

/**
 * Board order: quick wins, then big bets, then filler, then money pits, and
 * within a quadrant the higher impact first.
 *
 * Sorting on a derived quadrant rather than on a computed score, because a
 * score would combine two three point scales into a number that looks more
 * precise than either of them.
 */
const RANK: Record<Quadrant, number> = { 'quick-win': 0, 'big-bet': 1, filler: 2, 'money-pit': 3 }

export function boardOrder<T extends { effort: Level; impact: Level }>(ideas: T[]): T[] {
  return [...ideas].sort((a, b) => {
    const byQuadrant = RANK[quadrant(a.effort, a.impact)] - RANK[quadrant(b.effort, b.impact)]
    if (byQuadrant !== 0) return byQuadrant
    if (a.impact !== b.impact) return b.impact - a.impact
    return a.effort - b.effort
  })
}

export const LEVEL_WORDS: Record<string, Level> = { low: 1, med: 2, medium: 2, high: 3 }

export type Capture = { title: string; tags: string[]; effort: Level; impact: Level }

/**
 * The capture line: "#tags" are tags, "effort:low" and "impact:high" are the
 * scores, and whatever is left is the title. Medium by default on both axes,
 * because the board is where they get set properly.
 */
export function parseCapture(raw: string): Capture {
  const tags: string[] = []
  let effort: Level = 2
  let impact: Level = 2
  let text = raw.replace(/#(\w+)/g, (_, t: string) => {
    tags.push(t.toLowerCase())
    return ''
  })
  text = text.replace(/\beffort:(low|med|medium|high)\b/i, (_, v: string) => {
    effort = LEVEL_WORDS[v.toLowerCase()]
    return ''
  })
  text = text.replace(/\bimpact:(low|med|medium|high)\b/i, (_, v: string) => {
    impact = LEVEL_WORDS[v.toLowerCase()]
    return ''
  })
  return { title: text.replace(/\s+/g, ' ').trim(), tags: [...new Set(tags)], effort, impact }
}

/** The artboard's column order: impact twice over effort, higher first. */
export function boardScore(idea: { effort: Level; impact: Level }): number {
  return idea.impact * 2 - idea.effort
}
