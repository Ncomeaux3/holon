import { db } from '@/core/db'
import { quadrant, type Level } from '../quadrant'

export type IdeasDigest = {
  byStage: Record<string, number>
  /** Cheap and worthwhile, not yet started. The list worth acting on. */
  quickWins: { id: string; title: string }[]
  /** Exploring and untouched for sixty days. */
  stale: { id: string; title: string; days: number }[]
}

export async function nightlyDigest(): Promise<IdeasDigest> {
  const { rows } = await db().query<{
    id: string
    title: string
    stage: string
    effort: number
    impact: number
    days: number
  }>(
    `select id, title, stage, effort, impact,
            (core.today() - updated_at::date)::int as days
       from ideas.idea`,
  )

  const byStage: Record<string, number> = {}
  for (const idea of rows) byStage[idea.stage] = (byStage[idea.stage] ?? 0) + 1

  return {
    byStage,
    quickWins: rows
      .filter(
        (i) =>
          i.stage === 'exploring' &&
          quadrant(i.effort as Level, i.impact as Level) === 'quick-win',
      )
      .slice(0, 5)
      .map((i) => ({ id: i.id, title: i.title })),
    // Sixty days without a touch means it is not really being explored. Naming
    // it is not the same as killing it; the screen offers the choice.
    stale: rows
      .filter((i) => i.stage === 'exploring' && i.days >= 60)
      .sort((a, b) => b.days - a.days)
      .slice(0, 5)
      .map((i) => ({ id: i.id, title: i.title, days: i.days })),
  }
}
