import { afterAll, afterEach, describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const { db } = await import('@/core/db')
const { default: manifest } = await import('./manifest')
const { loadMergedTree } = await import('./tree')

const write = (input: unknown) => manifest.tools.write.run(input, { source: 'ui' })
const restore = (input: unknown) => manifest.tools.restore.run(input, { source: 'ui' })
const find = async (id: string) => (await loadMergedTree()).find((n) => n.id === id)

afterEach(async () => {
  await db().query('delete from skills.override')
})
afterAll(async () => {
  await db().end()
})

describe('skills.write', () => {
  it('renames a committed skill and remembers what it was called', async () => {
    await write({ kind: 'rename', skillId: 'typescript', name: 'TS' })
    expect(await find('typescript')).toMatchObject({ name: 'TS', renamedFrom: 'TypeScript' })
  })

  // Both edits land on one row, keyed (kind, skill_id). An upsert that replaced
  // the row would erase whichever edit came first, silently.
  it('renaming does not erase the keywords, and editing keywords does not erase the rename', async () => {
    await write({ kind: 'rename', skillId: 'typescript', keywords: ['ts', 'tsx'] })
    await write({ kind: 'rename', skillId: 'typescript', name: 'TS' })

    expect(await find('typescript')).toMatchObject({ name: 'TS', keywords: ['ts', 'tsx'] })

    await write({ kind: 'rename', skillId: 'typescript', keywords: ['ts'] })
    expect(await find('typescript')).toMatchObject({ name: 'TS', keywords: ['ts'] })
  })

  it('adds a custom skill under an attribute', async () => {
    await write({ kind: 'custom', skillId: 'hvac', name: 'HVAC', parent: 'health' })
    expect(await find('hvac')).toMatchObject({ name: 'HVAC', parent: 'health', origin: 'custom' })
  })

  it('deletes a skill without removing it from the merged tree, so it can come back', async () => {
    await write({ kind: 'delete', skillId: 'typescript' })
    expect(await find('typescript')).toMatchObject({ deleted: true })
  })

  // defineTool parses outside the async boundary, so a bad input throws rather
  // than rejecting. Every caller reaches tools through callTool, which catches
  // both the same way.
  it('refuses a skill id that is not an identifier', () => {
    expect(() => write({ kind: 'custom', skillId: 'Drop Table', name: 'x' })).toThrow()
  })
})

describe('skills.restore', () => {
  it('drops the overrides on one skill and leaves the rest', async () => {
    await write({ kind: 'rename', skillId: 'typescript', name: 'TS' })
    await write({ kind: 'delete', skillId: 'python' })

    await restore({ skillId: 'typescript' })

    expect(await find('typescript')).toMatchObject({ name: 'TypeScript' })
    expect(await find('python')).toMatchObject({ deleted: true })
  })

  it('with no skill id, resets the whole tree to skills.yaml', async () => {
    await write({ kind: 'rename', skillId: 'typescript', name: 'TS' })
    await write({ kind: 'custom', skillId: 'hvac', name: 'HVAC', parent: 'health' })

    expect(await restore({})).toMatchObject({ dropped: 2 })

    expect(await find('typescript')).toMatchObject({ name: 'TypeScript' })
    expect(await find('hvac')).toBeUndefined()
  })
})
