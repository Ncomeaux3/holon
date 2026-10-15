import { db } from '@/core/db'
import { search } from '@/core/search'

export type Related = { id: string; slug: string; title: string; similarity: number }

/**
 * Cosine distance past which a row does not count as related.
 *
 * Measured 2026-09-08 against five demo notes, the same calibration
 * core/search.ts uses for its own threshold. A starting point, not a
 * constant: re-measure once a real corpus exists.
 */
const THRESHOLD = 0.7

/**
 * Other published notes near this one, by embedding distance.
 *
 * Empty when the note has no embedding yet: the inner joins to core.embeddings
 * simply match nothing, so there is no separate check to make.
 */
export async function relatedTo(noteId: string, limit = 5, threshold = THRESHOLD): Promise<Related[]> {
  const { rows } = await db().query<{ id: string; slug: string; title: string; similarity: string }>(
    `select bn.id, bn.slug, bn.title,
            (1 - (es.embedding <=> en.embedding))::text as similarity
       from core.entities s
       join core.embeddings es on es.entity_id = s.id and es.embedding is not null
       join core.entities n on n.module = 'brain' and n.entity_type = 'note' and n.id <> s.id
       join core.embeddings en on en.entity_id = n.id and en.embedding is not null
       join brain.note bn on bn.id::text = n.entity_id and bn.status = 'published'
      where s.module = 'brain' and s.entity_type = 'note' and s.entity_id = $1
        and 1 - (es.embedding <=> en.embedding) >= $2
      order by es.embedding <=> en.embedding
      limit $3`,
    [noteId, threshold, limit],
  )
  return rows.map((r) => ({ id: r.id, slug: r.slug, title: r.title, similarity: Number(r.similarity) }))
}

/** Related notes for text that has no note of its own yet, such as a draft in progress. */
export async function relatedToText(text: string): Promise<Related[]> {
  const { hits } = await search(text, { module: 'brain', limit: 6 })
  if (hits.length === 0) return []

  const { rows } = await db().query<{ id: string; slug: string; title: string }>(
    `select id, slug, title from brain.note where id = any($1::uuid[]) and status = 'published'`,
    [hits.map((h) => h.entityId)],
  )
  const byId = new Map(rows.map((r) => [r.id, r]))

  return hits
    .map((hit) => {
      const note = byId.get(hit.entityId)
      return note ? { id: note.id, slug: note.slug, title: note.title, similarity: hit.score } : null
    })
    .filter((r): r is Related => r !== null)
}
