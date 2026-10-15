import { Eyebrow, PageHeader } from '@/components/pos'
import { db } from '@/core/db'
import { getSkillNames } from '@/core/modules'
import { listSkillLinks } from '@/core/skill-links'
import { listGoals, listIdeas, relatedNotes, similarPair } from '../data'
import { Ideas, IdeasCrumb, ViewSwitch, type IdeasData } from './Ideas'

/** Sitting in Exploring this long and it is not really being explored. */
export const STALE_DAYS = 60

export default async function IdeasPage() {
  const [rows, goals, links, names, notes, pair] = await Promise.all([
    listIdeas(),
    listGoals(),
    listSkillLinks('ideas', 'idea'),
    getSkillNames(),
    relatedNotes(),
    similarPair(),
  ])

  // The latest run per idea. distinct on rather than a join with a max
  // subquery: one statement, and the screen only ever shows the newest.
  const { rows: research } = await db().query<{
    idea_id: string
    depth: string
    status: string
    verdict: string
    confidence: string | null
    sections: { key: string; label: string; summary: string; claims: { text: string; source: string }[] }[]
    sources: { url: string; title: string; citedText: string }[]
    searches: number
    cost_cents: string
    detail: string
    ran_on: string
  }>(
    `select distinct on (idea_id)
            idea_id, depth, status, verdict, confidence::text, sections, sources,
            searches, cost_cents::text, detail, created_at::date::text as ran_on
       from ideas.research
      order by idea_id, created_at desc`,
  )

  const data: IdeasData = {
    goals,
    skills: Object.entries(names),
    pair,
    research: research.map((r) => ({
      ideaId: r.idea_id,
      depth: r.depth,
      status: r.status,
      verdict: r.verdict,
      confidence: r.confidence === null ? null : Number(r.confidence),
      sections: r.sections,
      sources: r.sources,
      searches: r.searches,
      costCents: Number(r.cost_cents),
      detail: r.detail,
      ranOn: r.ran_on,
    })),
    ideas: rows.map((r) => ({
      id: r.id,
      title: r.title,
      pitch: r.pitch,
      notes: r.notes,
      stage: r.stage,
      effort: r.effort,
      impact: r.impact,
      killedReason: r.killed_reason,
      tags: r.tags,
      goalRef: r.goal_ref,
      goalTitle: r.goal_title,
      draftTitle: r.draft_title,
      daysInStage: r.days_in_stage,
      stale: r.stage === 'exploring' && r.days_in_stage >= STALE_DAYS,
      entityRef: links.get(r.id)?.entityRef ?? null,
      skills: links.get(r.id)?.skills ?? [],
      related: notes
        .filter((n) => n.idea_id === r.id)
        .map((n) => ({ title: n.title, similarity: n.similarity })),
    })),
  }

  const live = data.ideas.filter((i) => i.stage !== 'killed').length
  const stale = data.ideas.filter((i) => i.stale).length

  return (
    <div className="space-y-[18px]">
      <PageHeader
        eyebrow={<IdeasCrumb />}
        status={
          <Eyebrow dot={stale > 0 ? 'warn' : 'ok'} className="whitespace-nowrap">
            {live} ideas · {stale} stale
          </Eyebrow>
        }
        title="Ideas"
        lede="Product and business ideas, scored on effort and impact. Columns are stages; ideas sit still for 60 days before they count as stale."
        actions={<ViewSwitch />}
      />
      <Ideas data={data} />
    </div>
  )
}
