import { createHash } from 'node:crypto'
import { embed, VOYAGE_DIMENSIONS } from '@/integrations/voyage/client'
import { db } from './db'
import { recordError } from './log'

// Hybrid search over core.entities: a vector query and a full text query merged
// by reciprocal rank. Exposed as the core.search MCP tool and the Search page.
//
// Nothing here reaches into a module's own tables. core.entities carries the
// title and the indexable body, which is what lets one index cover every module
// without core knowing any of them.

export type Ranked = { id: string; rank: number }
export type Fused = { id: string; score: number }

/**
 * Reciprocal rank fusion. The constant damps the difference between the top
 * ranks, so a result both retrievers agree on outranks one that only the
 * stronger retriever found. 60 is the value the original paper uses and the one
 * every implementation since has kept.
 */
const RRF_K = 60

/**
 * Cosine distance past which a row is not a match at all.
 *
 * Without this the vector arm returns its whole page for any query, because
 * ranking by distance always produces a ranking: once Voyage was connected,
 * "zzzznotathing" matched all five demo notes and the no-results state became
 * unreachable.
 *
 * Measured 2026-09-08 against the demo corpus. "barbell technique" puts the
 * true match at 0.504 and the nearest unrelated note at 0.750, so 0.70 keeps
 * the match and drops the noise. That is one query against five documents, so
 * treat it as a starting calibration, not a constant: re-measure once a real
 * corpus exists, and expect to raise it if genuine matches start disappearing.
 */
const VECTOR_MAX_DISTANCE = 0.7

export function fuseByRank(vector: Ranked[], text: Ranked[]): Fused[] {
  const scores = new Map<string, number>()

  for (const list of [vector, text]) {
    for (const { id, rank } of list) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank))
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
}

/**
 * What decides whether a row needs re-embedding. The length prefix means moving
 * the split between title and body changes the hash, which a plain join would
 * not: "ab" + "c" and "a" + "bc" are different rows and must hash differently.
 */
export function contentHash(title: string, body: string | null): string {
  const b = body ?? ''
  return createHash('sha256').update(`${title.length}:${title}${b}`).digest('hex')
}

/** The text that gets embedded and indexed for one entity. */
function indexText(title: string, body: string | null): string {
  return body ? `${title}\n${body}` : title
}

export type EmbedResult = { scanned: number; indexed: number; embedded: number }

/**
 * The nightly indexing pass, in two halves.
 *
 * Full text costs nothing, so it runs unconditionally for every row whose hash
 * moved: `tsv` lives on core.embeddings, and without this pass a search finds
 * nothing at all until Voyage is connected. The vector half then fills in the
 * rows that have no embedding yet, and is skipped entirely when Voyage is not
 * connected rather than failing the whole job.
 *
 * `content_hash` tracks the indexed text. Embedding freshness is a separate
 * question answered by `embedding is null`, so a row indexed before Voyage
 * arrived is still picked up on the first run after it does.
 */
export async function embedChanged(limit = 256): Promise<EmbedResult> {
  const { rows } = await db().query<{
    id: string
    title: string
    body: string | null
    stored_hash: string | null
    has_vector: boolean
  }>(
    `select e.id, e.title, e.body,
            em.content_hash as stored_hash,
            (em.embedding is not null) as has_vector
       from core.entities e
       left join core.embeddings em on em.entity_id = e.id
      order by e.updated_at desc
      limit $1`,
    [limit],
  )

  const withHash = rows.map((r) => ({ ...r, hash: contentHash(r.title, r.body) }))
  const staleText = withHash.filter((r) => r.hash !== r.stored_hash)

  for (const row of staleText) {
    await db().query(
      `insert into core.embeddings (entity_id, content_hash, tsv)
       values ($1, $2, to_tsvector('english', $3))
       on conflict (entity_id) do update
         set content_hash = excluded.content_hash, tsv = excluded.tsv`,
      [row.id, row.hash, indexText(row.title, row.body)],
    )
  }

  // Anything whose text just changed needs a new vector, and so does anything
  // that never got one.
  const staleVector = withHash.filter((r) => !r.has_vector || r.hash !== r.stored_hash)
  if (staleVector.length === 0) {
    return { scanned: rows.length, indexed: staleText.length, embedded: 0 }
  }

  let vectors: number[][]
  try {
    vectors = await embed(staleVector.map((r) => indexText(r.title, r.body)))
  } catch (error) {
    // Not connected, or the call failed. The text index is already written, so
    // search still works; the vectors arrive on the next run. The reason is
    // recorded, or "embedded: 0" every night would never say why.
    await recordError('search.embed', error)
    return { scanned: rows.length, indexed: staleText.length, embedded: 0 }
  }

  for (const [i, row] of staleVector.entries()) {
    const vector = vectors[i]
    if (!vector || vector.length !== VOYAGE_DIMENSIONS) {
      throw new Error(`Voyage returned ${vector?.length ?? 0} dimensions, expected ${VOYAGE_DIMENSIONS}`)
    }

    await db().query(
      `update core.embeddings
          set embedding = $2::vector, embedded_at = now()
        where entity_id = $1`,
      [row.id, JSON.stringify(vector)],
    )
  }

  return { scanned: rows.length, indexed: staleText.length, embedded: staleVector.length }
}

export type SearchHit = {
  id: string
  module: string
  entityType: string
  entityId: string
  title: string
  snippet: string | null
  score: number
  /** When the registry row last changed, as an ISO date. */
  updatedAt: string
}

export type SearchOptions = {
  module?: string
  limit?: number
  /**
   * Skip the vector arm. The command palette passes false: it fires on every
   * keystroke and you are jumping to a thing you can already name, so it is not
   * worth an embed call against a 3 RPM ceiling.
   */
  semantic?: boolean
}

/**
 * How the answer was produced.
 *
 * `text`     full text answered it, so no embedding was bought.
 * `guessed`  the words found nothing and these are the vector arm's nearest
 *            neighbours. They are guesses, not matches, and the page has to say
 *            so: a distance threshold is itself a guess, it was calibrated
 *            against five documents, and it drifts as the corpus grows. Framing
 *            beats tuning, because framing cannot go stale.
 * `degraded` the vector arm was wanted and could not run.
 */
export type SearchMode = 'text' | 'guessed' | 'degraded'

export type SearchResult = {
  hits: SearchHit[]
  mode: SearchMode
}

/**
 * A courtesy limiter matching the free tier ceiling. Without it a burst spends
 * its requests on 429s, paying the latency and getting nothing; with it the
 * fourth query inside a minute falls back to words immediately.
 *
 * Per process, so on serverless it is approximate. It is a politeness budget,
 * not a guarantee, and the try/catch below is still the real safety net.
 */
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 3
const recentCalls: number[] = []

function withinRateLimit(): boolean {
  const cutoff = Date.now() - RATE_WINDOW_MS
  while (recentCalls.length > 0 && recentCalls[0] < cutoff) recentCalls.shift()
  return recentCalls.length < RATE_MAX
}

/**
 * Query embeddings, kept for the life of the process.
 *
 * Voyage allows 3 requests per minute until a payment method is on file
 * (verified 2026-09-08), and every search costs one. Refining a query, paging,
 * or reloading a shared search URL would each burn one of the three without
 * this. Documents are not cached: those go through content_hash.
 */
const queryVectors = new Map<string, string>()
const QUERY_CACHE_MAX = 200

async function queryVector(q: string): Promise<string | null> {
  const hit = queryVectors.get(q)
  if (hit) return hit

  // A cached query costs nothing, so the budget is only checked on a miss.
  if (!withinRateLimit()) return null

  try {
    recentCalls.push(Date.now())
    const [embedded] = await embed([q], 'query')
    if (!embedded) return null

    const json = JSON.stringify(embedded)
    // Cheapest possible eviction: drop the oldest key. Map keeps insertion
    // order, and this cache exists to survive a burst, not a day.
    if (queryVectors.size >= QUERY_CACHE_MAX) {
      queryVectors.delete(queryVectors.keys().next().value!)
    }
    queryVectors.set(q, json)
    return json
  } catch {
    // Rate limited, not connected, or the call failed. Full text carries the
    // query on its own; the caller is told the difference.
    return null
  }
}

/**
 * One statement, two retrievers, merged in SQL so the ranks come back already
 * fused. Doing the merge in Postgres rather than in TypeScript keeps the row
 * cap honest: without it both CTEs would have to be fully materialised here.
 *
 * The vector arm is skipped when the query cannot be embedded, which is the
 * case before Voyage is connected. Full text alone still answers exact terms.
 */
/** One pass of the fused query. `vector` null means the text arm alone. */
async function runSearch(
  q: string,
  vector: string | null,
  opts: SearchOptions,
): Promise<SearchHit[]> {
  const limit = Math.min(opts.limit ?? 20, 100)
  const pool = Math.max(limit * 3, 60)

  const { rows } = await db().query<SearchHit & { score: string }>(
    `with scoped as (
       select e.id, e.module, e.entity_type, e.entity_id, e.title, e.body, em.embedding, em.tsv
         from core.entities e
         join core.embeddings em on em.entity_id = e.id
        where ($3::text is null or e.module = $3)
     ),
     vec as (
       select id, row_number() over (order by embedding <=> $1::vector) as rank
         from scoped
        where $1::vector is not null
          and embedding is not null
          and (embedding <=> $1::vector) < $6
        limit $4
     ),
     txt as (
       select id, row_number() over (
                order by ts_rank(tsv, websearch_to_tsquery('english', $2)) desc
              ) as rank
         from scoped
        where tsv @@ websearch_to_tsquery('english', $2)
        limit $4
     ),
     fused as (
       select coalesce(vec.id, txt.id) as id,
              coalesce(1.0 / (60 + vec.rank), 0) + coalesce(1.0 / (60 + txt.rank), 0) as score
         from vec
         full outer join txt on txt.id = vec.id
     )
     select e.id, e.module, e.entity_type as "entityType", e.entity_id as "entityId",
            e.title, left(e.body, 200) as snippet, fused.score::text as score,
            e.updated_at::date::text as "updatedAt"
       from fused
       join core.entities e on e.id = fused.id
      order by fused.score desc
      limit $5`,
    [vector, q, opts.module ?? null, pool, limit, VECTOR_MAX_DISTANCE],
  )

  return rows.map((r) => ({ ...r, score: Number(r.score) }))
}

/**
 * Words first, meaning only when words come up short.
 *
 * Both arms are merged by reciprocal rank in one statement, so the ranks come
 * back already fused and the row cap stays honest. What decides whether the
 * vector arm runs at all is cost: on the free tier an embedded query is one of
 * three a minute, and a query full text already answered does not need one.
 *
 * The extra database round trip in the thin case is far cheaper than the HTTP
 * call it avoids in the common one.
 */
export async function search(query: string, opts: SearchOptions = {}): Promise<SearchResult> {
  const q = query.trim()
  if (!q) return { hits: [], mode: 'text' }

  const byText = await runSearch(q, null, opts)

  // Meaning is bought only when words found nothing.
  //
  // Voyage allows 3 requests a minute on the free tier and every embedded query
  // spends one, so the cheapest request is the one not made. A hit on the words
  // is already an answer: searching "deadlift" and getting "Deadlift form
  // check" needs no help. Searching "barbell technique" for the same note does,
  // and that is exactly the case this pays for.
  //
  // Any count-based threshold here would be wrong, because how many hits count
  // as enough depends on how big the corpus is. Zero does not.
  if (opts.semantic === false || byText.length > 0) {
    return { hits: byText, mode: 'text' }
  }

  const vector = await queryVector(q)
  if (!vector) return { hits: byText, mode: 'degraded' }

  // The words found nothing, so every hit here came from the vector arm and is
  // a nearest neighbour, not a match. 'guessed' is what lets the page say so:
  // rendering a semantic neighbour as a result claims a match that was never
  // made, and for a query with no real answer that reads as a wrong answer.
  return { hits: await runSearch(q, vector, opts), mode: 'guessed' }
}

/**
 * The fallback the Search page shows instead of a bare zero state: anything
 * whose title shares a trigram with the query. Cheap, and it turns "nothing
 * matched" into "did you mean".
 */
export async function closest(query: string, limit = 5): Promise<SearchHit[]> {
  const q = query.trim()
  if (q.length < 3) return []

  const { rows } = await db().query<SearchHit & { score: string }>(
    `select id, module, entity_type as "entityType", entity_id as "entityId",
            title, left(body, 200) as snippet, '0' as score,
            updated_at::date::text as "updatedAt"
       from core.entities
      where title ilike '%' || $1 || '%' or body ilike '%' || $1 || '%'
      order by length(title)
      limit $2`,
    [q, limit],
  )

  return rows.map((r) => ({ ...r, score: 0 }))
}
