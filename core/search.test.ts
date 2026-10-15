import { beforeEach, describe, expect, it, vi } from 'vitest'
import { contentHash, fuseByRank, type Ranked } from './search'

// The merge and the hash are pure, so they are tested without a database or a
// Voyage key. The batching behaviour that costs money is tested against a
// mocked client further down.

describe('fuseByRank', () => {
  const at = (ids: string[]): Ranked[] => ids.map((id, i) => ({ id, rank: i + 1 }))

  it('puts a result that both lists rank first at the top', () => {
    const merged = fuseByRank(at(['a', 'b', 'c']), at(['a', 'c', 'b']))
    expect(merged[0].id).toBe('a')
  })

  it('ranks a result found by both lists above one found by only the better list', () => {
    // 'b' is second on both. 'a' is first on one list and absent from the other.
    // 1/61 + 1/61 = 0.0328 beats 1/60 = 0.0167, which is the whole point of
    // reciprocal rank fusion: agreement outweighs a single strong hit.
    const merged = fuseByRank(at(['a', 'b']), at(['c', 'b']))
    expect(merged[0].id).toBe('b')
  })

  it('keeps a result that only one list found', () => {
    const merged = fuseByRank(at(['a']), at(['b']))
    expect(merged.map((r) => r.id).sort()).toEqual(['a', 'b'])
  })

  it('returns nothing for two empty lists', () => {
    expect(fuseByRank([], [])).toEqual([])
  })

  it('is stable when one side is empty', () => {
    expect(fuseByRank(at(['a', 'b']), []).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('scores descending', () => {
    const merged = fuseByRank(at(['a', 'b', 'c']), at(['a', 'b', 'c']))
    const scores = merged.map((r) => r.score)
    expect(scores).toEqual([...scores].sort((x, y) => y - x))
  })
})

describe('contentHash', () => {
  it('is stable for the same text', () => {
    expect(contentHash('Deadlift form check', 'bar drifting')).toBe(
      contentHash('Deadlift form check', 'bar drifting'),
    )
  })

  it('changes when the title changes', () => {
    expect(contentHash('a', 'body')).not.toBe(contentHash('b', 'body'))
  })

  it('changes when the body changes', () => {
    expect(contentHash('title', 'a')).not.toBe(contentHash('title', 'b'))
  })

  it('treats a missing body as empty rather than throwing', () => {
    expect(contentHash('title', null)).toBe(contentHash('title', ''))
  })

  it('does not collide when the split between title and body moves', () => {
    // Naive concatenation would hash these the same.
    expect(contentHash('ab', 'c')).not.toBe(contentHash('a', 'bc'))
  })
})

// embedChanged is the part that spends money, so what it must not do is call
// Voyage for rows whose content has not moved.
describe('embedChanged', () => {
  beforeEach(() => vi.resetModules())

  type Row = {
    id: string
    title: string
    body: string | null
    stored: string | null
    /** Whether the row already has a vector. A text-only index leaves it false. */
    vector?: boolean
  }

  async function run(rows: Row[], voyage: 'ok' | 'down' = 'ok') {
    const calls: string[][] = []

    vi.doMock('@/integrations/voyage/client', () => ({
      VOYAGE_DIMENSIONS: 1024,
      embed: async (texts: string[]) => {
        calls.push(texts)
        if (voyage === 'down') throw new Error('Voyage is not connected.')
        return texts.map(() => new Array(1024).fill(0))
      },
    }))

    const textUpserts: string[] = []
    const vectorWrites: string[] = []
    vi.doMock('./db', () => ({
      db: () => ({
        query: async (sql: string, params?: unknown[]) => {
          if (sql.includes('from core.entities')) {
            return {
              rows: rows.map((r) => ({
                id: r.id,
                title: r.title,
                body: r.body,
                stored_hash: r.stored,
                has_vector: r.vector ?? false,
              })),
            }
          }
          if (sql.includes('insert into core.embeddings')) {
            textUpserts.push(String((params as unknown[])[0]))
          }
          if (sql.includes('update core.embeddings')) {
            vectorWrites.push(String((params as unknown[])[0]))
          }
          return { rows: [] }
        },
      }),
    }))

    const { embedChanged } = await import('./search')
    const result = await embedChanged()
    return { calls, textUpserts, vectorWrites, result }
  }

  it('does nothing at all when the hash matches and the vector exists', async () => {
    const title = 'Sharpen the kitchen knives'
    // The statically imported copy: importing ./search again here would resolve
    // it before vi.doMock runs and hand embedChanged the real database.
    const { calls, textUpserts, result } = await run([
      { id: 'e1', title, body: '', stored: contentHash(title, ''), vector: true },
    ])

    expect(calls).toEqual([])
    expect(textUpserts).toEqual([])
    expect(result).toMatchObject({ indexed: 0, embedded: 0 })
  })

  it('re-embeds a row whose text is unchanged but which has no vector yet', async () => {
    const title = 'Indexed before Voyage was connected'
    const { calls, textUpserts, vectorWrites } = await run([
      { id: 'e1', title, body: '', stored: contentHash(title, ''), vector: false },
    ])

    // The text is already current, so it is not rewritten, but the missing
    // vector still gets filled in.
    expect(textUpserts).toEqual([])
    expect(calls).toHaveLength(1)
    expect(vectorWrites).toEqual(['e1'])
  })

  it('calls Voyage once for a row whose title changed', async () => {
    const { calls, textUpserts, vectorWrites, result } = await run([
      { id: 'e1', title: 'New title', body: '', stored: 'stale-hash', vector: true },
    ])

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(['New title'])
    expect(textUpserts).toEqual(['e1'])
    expect(vectorWrites).toEqual(['e1'])
    expect(result.embedded).toBe(1)
  })

  it('sends one batched request for several changed rows', async () => {
    const { calls } = await run([
      { id: 'e1', title: 'One', body: null, stored: null },
      { id: 'e2', title: 'Two', body: null, stored: null },
      { id: 'e3', title: 'Three', body: null, stored: null },
    ])

    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(3)
  })

  it('still writes the text index when Voyage is not connected', async () => {
    const { textUpserts, vectorWrites, result } = await run(
      [{ id: 'e1', title: 'Findable by words alone', body: null, stored: null }],
      'down',
    )

    // This is the whole point of splitting the pass: search works on text
    // before a key is ever pasted, and the vectors arrive on a later run.
    expect(textUpserts).toEqual(['e1'])
    expect(vectorWrites).toEqual([])
    expect(result).toMatchObject({ indexed: 1, embedded: 0 })
  })
})
