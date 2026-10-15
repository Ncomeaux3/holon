import { db } from '@/core/db'
import { register } from '@/core/entities'
import { completeWithSearch, NotConnected, SoftCapExceeded } from '@/core/llm'
import { parseReport, searchBudget, SECTIONS, SYSTEM } from '../rubric'

// The research job from SPEC section 2. One model call with web search, a fixed
// rubric, and a hard rule applied to what comes back: a number with no source
// the search actually returned is deleted before the row is written.
//
// Search is billed at a cent each on top of tokens, so the run stores what it
// spent and the screen shows it. The soft cap already covers this: research is
// a capped purpose and the search cost goes into the same cost_cents the cap
// reads.

export type ResearchRun = {
  ideaId: string
  status: 'ok' | 'failed'
  verdict: string
  searches: number
  costCents: number
  detail: string
}

export async function researchIdea(
  ideaId: string,
  depth: 'quick' | 'deep' = 'quick',
): Promise<ResearchRun> {
  const { rows } = await db().query<{ title: string; pitch: string; notes: string }>(
    `select title, pitch, notes from ideas.idea where id = $1`,
    [ideaId],
  )
  if (rows.length === 0) throw new Error(`No idea ${ideaId}`)
  const idea = rows[0]

  const model = 'claude-sonnet-5'
  const prompt = [
    `Idea: ${idea.title}`,
    idea.pitch ? `Pitch: ${idea.pitch}` : '',
    idea.notes ? `Notes: ${idea.notes}` : '',
    '',
    'Work through these, in this order:',
    ...SECTIONS.map((s) => `- ${s.label}: ${s.ask}`),
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const result = await completeWithSearch({
      model,
      purpose: 'research',
      module: 'ideas',
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4000,
      maxSearches: searchBudget(depth),
    })

    const report = parseReport(
      result.text,
      result.sources.map((s) => s.url),
    )

    await db().query(
      `insert into ideas.research
         (idea_id, depth, status, verdict, confidence, sections, sources, searches,
          cost_cents, model)
       values ($1, $2, 'ok', $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)`,
      [
        ideaId,
        depth,
        report.verdict,
        report.confidence,
        JSON.stringify(report.sections),
        JSON.stringify(result.sources),
        result.searches,
        result.costCents,
        model,
      ],
    )

    await register({
      module: 'ideas',
      entityType: 'idea',
      entityId: ideaId,
      title: idea.title,
      text: idea.pitch,
      eventType: 'idea_researched',
    })

    return {
      ideaId,
      status: 'ok',
      verdict: report.verdict,
      searches: result.searches,
      costCents: result.costCents,
      detail: '',
    }
  } catch (error) {
    // A failed run is a row too. Without it the screen cannot tell "never
    // researched" from "tried and the key was missing", and those need
    // different things from the owner.
    const detail =
      error instanceof SoftCapExceeded || error instanceof NotConnected
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Research failed'

    await db().query(
      `insert into ideas.research (idea_id, depth, status, detail, model)
       values ($1, $2, 'failed', $3, $4)`,
      [ideaId, depth, detail, model],
    )

    return { ideaId, status: 'failed', verdict: '', searches: 0, costCents: 0, detail }
  }
}
