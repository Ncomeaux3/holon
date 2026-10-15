import { describe, expect, it } from 'vitest'
import { applyOverrides, loadYaml, type SkillNode } from './tree'

// The merge is what makes the committed tree generic and the owner's tree real.
// Getting it wrong either loses their edits or ships their skills in the repo.

const base: SkillNode[] = [
  { id: 'engineering', name: 'Engineering' },
  { id: 'coding', parent: 'engineering', name: 'Coding' },
  { id: 'typescript', parent: 'coding', name: 'TypeScript', keywords: ['typescript'] },
  { id: 'health', name: 'Health' },
]

const o = (kind: 'custom' | 'rename' | 'delete', skill_id: string, extra = {}) => ({
  kind,
  skill_id,
  name: null,
  parent: null,
  keywords: [] as string[],
  ...extra,
})

describe('applyOverrides', () => {
  it('returns the committed tree when there is nothing to apply', () => {
    expect(applyOverrides(base, [])).toEqual(base)
  })

  it('adds a custom skill', () => {
    const tree = applyOverrides(base, [
      o('custom', 'hvac', { name: 'HVAC', parent: 'health', keywords: ['hvac', 'furnace'] }),
    ])
    expect(tree.find((n) => n.id === 'hvac')).toMatchObject({
      name: 'HVAC',
      parent: 'health',
      keywords: ['hvac', 'furnace'],
    })
  })

  it('renames without touching anything else', () => {
    const tree = applyOverrides(base, [o('rename', 'typescript', { name: 'TS' })])
    const node = tree.find((n) => n.id === 'typescript')!
    expect(node.name).toBe('TS')
    expect(node.keywords).toEqual(['typescript'])
    expect(node.parent).toBe('coding')
  })

  it('replaces keywords when the rename supplies them', () => {
    const tree = applyOverrides(base, [o('rename', 'typescript', { keywords: ['ts', 'tsx'] })])
    expect(tree.find((n) => n.id === 'typescript')!.keywords).toEqual(['ts', 'tsx'])
  })

  it('deletes a leaf', () => {
    const tree = applyOverrides(base, [o('delete', 'typescript')])
    expect(tree.map((n) => n.id)).not.toContain('typescript')
    expect(tree.map((n) => n.id)).toContain('coding')
  })

  // A deleted parent that left its children behind would put orphans in the
  // tree that no view can place and no XP can roll up.
  it('takes descendants with a deleted parent, to any depth', () => {
    const tree = applyOverrides(base, [o('delete', 'engineering')])
    expect(tree.map((n) => n.id)).toEqual(['health'])
  })

  it('can rename a skill it just created', () => {
    const tree = applyOverrides(base, [
      o('custom', 'hvac', { name: 'HVAC', parent: 'health' }),
      o('rename', 'hvac', { name: 'Home systems' }),
    ])
    expect(tree.find((n) => n.id === 'hvac')!.name).toBe('Home systems')
  })

  it('ignores a rename of a skill that does not exist', () => {
    expect(() => applyOverrides(base, [o('rename', 'ghost', { name: 'Ghost' })])).not.toThrow()
  })

  it('does not mutate the committed tree', () => {
    applyOverrides(base, [o('rename', 'typescript', { name: 'TS' })])
    expect(base.find((n) => n.id === 'typescript')!.name).toBe('TypeScript')
  })
})

describe('loadYaml', () => {
  it('is generic: the committed tree holds nothing personal', () => {
    // A fork gets this file as is. If a real skill lands here it ships to
    // everyone who clones the template.
    const ids = loadYaml().map((n) => n.id)
    expect(ids).toContain('engineering')
    expect(ids).toContain('health')
  })
})
