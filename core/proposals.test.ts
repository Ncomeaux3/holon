import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { approve, countPending, dismiss, listProposals, propose, reopen } from './proposals'
import { setSetting } from './settings'
import { callQuery, callTool } from './tools'

// Against the real database and the real ideas module, because the thing worth
// proving is that a guarded agent call does not reach ideas.idea.

async function ideasCount(): Promise<number> {
  const { rows } = await db().query<{ n: string }>('select count(*)::text as n from ideas.idea')
  return Number(rows[0].n)
}

beforeEach(async () => {
  await db().query('delete from core.proposals')
  await db().query('delete from core.events')
  await db().query('delete from core.entities')
  await db().query('delete from ideas.idea')
  await db().query('delete from core.settings')
})

describe('the guard', () => {
  it('holds a guarded agent write as a proposal and writes nothing', async () => {
    // ideas does not guard write, so the default autonomy lets this one run.
    const before = await ideasCount()

    const result = await callTool(
      'ideas',
      'write',
      { title: 'Agent wrote this' },
      { source: 'agent', agent: 'orchestrator', reason: 'Testing the guard.' },
    )

    // Default autonomy is 'propose' and ideas does not guard write, so this one runs.
    expect(result.status).toBe('done')
    expect(await ideasCount()).toBe(before + 1)
  })

  it('holds every agent write when autonomy is observe', async () => {
    await setSetting('agent_autonomy', 'observe')
    const before = await ideasCount()

    const result = await callTool(
      'ideas',
      'write',
      { title: 'Held back', pitch: 'nothing should be written' },
      { source: 'agent', agent: 'orchestrator', reason: 'Observe mode.' },
    )

    expect(result.status).toBe('proposed')
    expect(await ideasCount()).toBe(before)
    expect(await countPending()).toBe(1)
  })

  it('lets the owner write through the UI even in observe mode', async () => {
    await setSetting('agent_autonomy', 'observe')
    const before = await ideasCount()

    const result = await callTool('ideas', 'write', { title: 'Mine' }, { source: 'ui' })

    expect(result.status).toBe('done')
    expect(await ideasCount()).toBe(before + 1)
    expect(await countPending()).toBe(0)
  })

  it('rejects a payload the tool would not accept, before storing it', async () => {
    await setSetting('agent_autonomy', 'observe')

    await expect(
      callTool('ideas', 'write', { title: '' }, { source: 'agent' }),
    ).rejects.toThrow()

    // Nothing stored, so the owner is never shown a proposal that cannot be
    // approved.
    expect(await countPending()).toBe(0)
  })
})

describe('deciding', () => {
  async function pending() {
    return propose({
      module: 'ideas',
      tool: 'write',
      payload: { title: 'Proposed idea', pitch: 'from an agent' },
      agent: 'orchestrator',
      reason: 'Because the test said so.',
      guarded: true,
    })
  }

  it('approve runs the tool and marks the row', async () => {
    const id = await pending()
    const before = await ideasCount()

    await approve(id)

    expect(await ideasCount()).toBe(before + 1)
    expect(await countPending()).toBe(0)
    expect((await listProposals('approved')).map((p) => p.id)).toEqual([id])
  })

  it('approve applies an edit from the Review panel', async () => {
    const id = await pending()
    await approve(id, { title: 'Edited before approving' })

    const { rows } = await db().query<{ title: string }>('select title from ideas.idea')
    expect(rows[0].title).toBe('Edited before approving')
  })

  it('approve refuses an edit the tool would reject, and writes nothing', async () => {
    const id = await pending()
    const before = await ideasCount()

    await expect(approve(id, { title: '' })).rejects.toThrow()

    expect(await ideasCount()).toBe(before)
    // Still pending, so a failed approval is visible rather than swallowed.
    expect(await countPending()).toBe(1)
  })

  it('refuses to approve the same proposal twice', async () => {
    const id = await pending()
    await approve(id)
    await expect(approve(id)).rejects.toThrow(/already approved/)
  })

  it('dismiss takes it out of the inbox without writing anything', async () => {
    const id = await pending()
    const before = await ideasCount()

    await dismiss(id)

    expect(await ideasCount()).toBe(before)
    expect(await countPending()).toBe(0)
    expect((await listProposals('dismissed')).map((p) => p.id)).toEqual([id])
  })

  it('a dismissed proposal is not re-proposed inside its window', async () => {
    const id = await pending()
    await dismiss(id)

    const again = await pending()

    expect(again).toBe(id)
    expect(await countPending()).toBe(0)
    expect((await listProposals('dismissed')).map((p) => p.id)).toEqual([id])
  })

  it('reopen puts a decided proposal back', async () => {
    const id = await pending()
    await dismiss(id)
    await reopen(id)

    expect(await countPending()).toBe(1)
  })
})

describe('the core query tool', () => {
  it('is available on a module that never defined one', async () => {
    expect(await callQuery('ideas', 'select count(*)::int as n from ideas.idea')).toEqual([{ n: 0 }])
  })

  it('is never guarded, because there is nothing to approve about a select', async () => {
    await setSetting('agent_autonomy', 'observe')

    expect(await callQuery('ideas', 'select 1 as n')).toEqual([{ n: 1 }])
    expect(await countPending()).toBe(0)
  })

  it('refuses a write dressed as a query', async () => {
    await expect(callQuery('ideas', 'delete from ideas.idea')).rejects.toThrow(/delete/i)
  })

  it('is not reachable through callTool, which every server action uses', async () => {
    await expect(
      callTool('ideas', 'query', { sql: 'select 1 as n' }, { source: 'ui' }),
    ).rejects.toThrow(/callQuery/)
  })
})
