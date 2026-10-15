import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { z } from 'zod'
import { callTool, fieldErrors, shouldGuard } from './tools'

// The whole access rule for agent writes, kept pure so the matrix is readable.
// The wiring that calls it is covered in proposals.test.ts against a database.

describe('shouldGuard', () => {
  const guarded = ['write', 'revalue']

  it('never guards a write the owner made in the UI', () => {
    for (const autonomy of ['observe', 'propose', 'act'] as const) {
      expect(shouldGuard({ source: 'ui', autonomy, guarded, tool: 'write' })).toBe(false)
    }
  })

  describe('observe', () => {
    it('guards everything, including tools no manifest listed', () => {
      expect(shouldGuard({ source: 'agent', autonomy: 'observe', guarded, tool: 'write' })).toBe(true)
      expect(shouldGuard({ source: 'agent', autonomy: 'observe', guarded, tool: 'get_digest' })).toBe(
        true,
      )
    })
  })

  describe('propose', () => {
    it('guards what the manifest listed', () => {
      expect(shouldGuard({ source: 'agent', autonomy: 'propose', guarded, tool: 'write' })).toBe(true)
      expect(shouldGuard({ source: 'agent', autonomy: 'propose', guarded, tool: 'revalue' })).toBe(
        true,
      )
    })

    it('lets an unguarded tool through', () => {
      expect(shouldGuard({ source: 'agent', autonomy: 'propose', guarded, tool: 'sync' })).toBe(false)
    })
  })

  describe('act', () => {
    it('guards nothing, because undo is what makes it safe', () => {
      expect(shouldGuard({ source: 'agent', autonomy: 'act', guarded, tool: 'write' })).toBe(false)
    })
  })

  it('treats a module with no guarded list as guarding nothing at propose level', () => {
    expect(shouldGuard({ source: 'agent', autonomy: 'propose', guarded: [], tool: 'write' })).toBe(
      false,
    )
  })
})

// Freshness: a write tool recomputes its module's digest so the dashboard
// tile reads this minute's numbers, and the one read tool a manifest names
// does not, or reading would write.
describe('callTool and the digest', () => {
  beforeEach(async () => {
    await db().query(`delete from core.digests where module = 'ideas'`)
    await db().query('delete from core.settings')
  })
  // The write leaves an idea, its registry row and its event behind, and
  // core/events.test.ts counts events; the file order follows cached
  // durations, so it failed only on a laptop that had run the suite before.
  afterAll(async () => {
    await db().query(`delete from core.events where module = 'ideas'`)
    await db().query(`delete from core.entities where module = 'ideas'`)
    await db().query(`delete from ideas.idea where title = 'Digest follows the write'`)
  })

  async function newestIdeasDigest(): Promise<Date | null> {
    const { rows } = await db().query<{ run_at: Date }>(
      `select run_at from core.digests where module = 'ideas' order by run_at desc limit 1`,
    )
    return rows[0]?.run_at ?? null
  }

  it('leaves a newer core.digests row after a write tool', async () => {
    expect(await newestIdeasDigest()).toBeNull()

    await callTool('ideas', 'write', { title: 'Digest follows the write' }, { source: 'ui' })

    expect(await newestIdeasDigest()).not.toBeNull()
  })

  it('does not write a digest for get_digest', async () => {
    await callTool('ideas', 'get_digest', {}, { source: 'ui' })

    expect(await newestIdeasDigest()).toBeNull()
  })
})

// The zod issues a tool rejects with, as one message per field. The toast and
// the form both read this; the raw issue array is JSON nobody should see.
describe('fieldErrors', () => {
  const schema = z.object({
    title: z.string().min(1).max(300),
    due_on: z.iso.date().nullable().optional(),
    estimated_minutes: z.number().int().optional(),
    kind: z.enum(['number', 'count']).optional(),
  })

  function issuesOf(input: unknown) {
    const r = schema.safeParse(input)
    if (r.success) throw new Error('expected a failure')
    return fieldErrors(r.error)
  }

  it('names a missing or empty required field', () => {
    expect(issuesOf({ title: '' })).toEqual({ title: 'Title is required' })
    expect(issuesOf({})).toEqual({ title: 'Title is required' })
  })

  it('carries the issue message for anything else, under the field label', () => {
    expect(issuesOf({ title: 'x', due_on: 'nope', estimated_minutes: 1.5, kind: 'streak' })).toEqual({
      due_on: 'Due on: Invalid ISO date',
      estimated_minutes: 'Estimated minutes: Invalid input: expected int, received number',
      kind: 'Kind: Invalid option: expected one of "number"|"count"',
    })
  })

  it('keeps the first issue per field', () => {
    expect(issuesOf({ title: 'x'.repeat(301), due_on: 'nope' })).toEqual({
      title: 'Title: Too big: expected string to have <=300 characters',
      due_on: 'Due on: Invalid ISO date',
    })
  })

  it('callTool rethrows a rejected input as a ToolInputError the form can read', async () => {
    await expect(callTool('ideas', 'write', { title: '' }, { source: 'ui' })).rejects.toMatchObject({
      name: 'ToolInputError',
      message: 'Title is required',
      fields: { title: 'Title is required' },
    })
  })
})
