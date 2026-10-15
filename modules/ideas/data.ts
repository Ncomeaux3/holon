import { db } from '@/core/db'
import type { Level } from './quadrant'

// Reads for the screen. The shape it renders lives in ./quadrant.ts, which a
// client component can import.

export type IdeaRow = {
  id: string
  title: string
  pitch: string
  notes: string
  stage: string
  effort: Level
  impact: Level
  killed_reason: string
  tags: string[]
  goal_ref: string | null
  goal_title: string | null
  draft_task_id: string | null
  draft_title: string | null
  /** Days since the stage last changed, on the owner's calendar. */
  days_in_stage: number
}

export async function listIdeas(): Promise<IdeaRow[]> {
  const { rows } = await db().query<IdeaRow>(
    `select i.id, i.title, i.pitch, i.notes, i.stage, i.effort, i.impact, i.killed_reason,
            i.tags, i.goal_ref, g.title as goal_title, i.draft_task_id, i.draft_title,
            (core.today() - i.stage_since::date)::int as days_in_stage
       from ideas.idea i
       -- The goal's title comes from the core registry, so this works before
       -- the goals module exists and needs no change when it lands.
       left join core.entities g on g.id = i.goal_ref
      order by i.updated_at desc`,
  )
  return rows
}

/** Goals as the registry knows them, for the Linked goal select. */
export async function listGoals(): Promise<{ id: string; title: string }[]> {
  const { rows } = await db().query<{ id: string; title: string }>(
    `select id, title from core.entities
      where module = 'goals' and entity_type = 'goal' order by title`,
  )
  return rows
}

export type SimilarPair = { a_id: string; b_id: string; similarity: number }

/**
 * The closest pair of live ideas, by the registry's embeddings, when the pair
 * is close enough to be the same idea twice. Null until Voyage has embedded
 * them, which is the truthful answer rather than an example.
 */
export async function similarPair(threshold = 0.85): Promise<SimilarPair | null> {
  const { rows } = await db().query<{ a_id: string; b_id: string; similarity: string }>(
    `select a.entity_id as a_id, b.entity_id as b_id,
            (1 - (ea.embedding <=> eb.embedding))::text as similarity
       from core.entities a
       join core.embeddings ea on ea.entity_id = a.id and ea.embedding is not null
       join ideas.idea ia on ia.id::text = a.entity_id and ia.stage <> 'killed'
       join core.entities b on b.module = 'ideas' and b.entity_type = 'idea' and b.id > a.id
       join core.embeddings eb on eb.entity_id = b.id and eb.embedding is not null
       join ideas.idea ib on ib.id::text = b.entity_id and ib.stage <> 'killed'
      where a.module = 'ideas' and a.entity_type = 'idea'
        and 1 - (ea.embedding <=> eb.embedding) >= $1
      order by ea.embedding <=> eb.embedding
      limit 1`,
    [threshold],
  )
  const row = rows[0]
  return row ? { a_id: row.a_id, b_id: row.b_id, similarity: Number(row.similarity) } : null
}

export type RelatedNote = { idea_id: string; title: string; similarity: number }

/** Second Brain notes near each idea, through the registry's embeddings only. */
export async function relatedNotes(threshold = 0.7): Promise<RelatedNote[]> {
  const { rows } = await db().query<{ idea_id: string; title: string; similarity: string }>(
    `select i.entity_id as idea_id, n.title,
            (1 - (ei.embedding <=> en.embedding))::text as similarity
       from core.entities i
       join core.embeddings ei on ei.entity_id = i.id and ei.embedding is not null
       join core.entities n on n.module = 'brain' and n.entity_type = 'note'
       join core.embeddings en on en.entity_id = n.id and en.embedding is not null
      where i.module = 'ideas' and i.entity_type = 'idea'
        and 1 - (ei.embedding <=> en.embedding) >= $1
      order by i.entity_id, ei.embedding <=> en.embedding`,
    [threshold],
  )
  return rows.map((r) => ({ idea_id: r.idea_id, title: r.title, similarity: Number(r.similarity) }))
}

export async function deleteIdea(id: string): Promise<void> {
  // The registry row goes and its skill links cascade; events stay, unlinked,
  // with their own title snapshot.
  await db().query(
    `delete from core.entities where module = 'ideas' and entity_type = 'idea' and entity_id = $1`,
    [id],
  )
  await db().query(`delete from ideas.idea where id = $1`, [id])
}
