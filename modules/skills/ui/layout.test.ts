import { describe, expect, it } from 'vitest'
import { loadYaml } from '../tree'
import { layout, nodeRadius, ROOT_ID } from './layout'

// The constellation has to be the same every load or a skill cannot be found
// twice. These are the properties that guarantee that, not pixel values.

describe('layout', () => {
  const placed = layout(loadYaml())
  const byId = new Map(placed.map((p) => [p.id, p]))

  it('places every node exactly once, plus the root', () => {
    const nodes = loadYaml()
    expect(placed).toHaveLength(nodes.length + 1)
    expect(new Set(placed.map((p) => p.id)).size).toBe(placed.length)
    for (const node of nodes) expect(byId.has(node.id), node.id).toBe(true)
  })

  it('is deterministic', () => {
    expect(layout(loadYaml())).toEqual(placed)
  })

  it('puts the root at the centre', () => {
    expect(byId.get(ROOT_ID)).toMatchObject({ x: 0, y: 0, ring: 'root' })
  })

  it('rings every node by whether it has children, not by depth', () => {
    // Health's children are leaves; Engineering's are categories. Both are
    // attributes, and the uneven tree is the reason layout cannot use depth.
    expect(byId.get('strength')!.ring).toBe('leaf')
    expect(byId.get('coding')!.ring).toBe('category')
    expect(byId.get('typescript')!.ring).toBe('leaf')
    expect(byId.get('health')!.ring).toBe('attribute')
  })

  it('puts leaves further out than their attribute', () => {
    const r = (id: string) => Math.hypot(byId.get(id)!.x, byId.get(id)!.y)
    expect(r('typescript')).toBeGreaterThan(r('engineering'))
    expect(r('strength')).toBeGreaterThan(r('health'))
  })

  it('puts a category between its attribute and its leaves', () => {
    const r = (id: string) => Math.hypot(byId.get(id)!.x, byId.get(id)!.y)
    expect(r('coding')).toBeGreaterThan(r('engineering'))
    expect(r('coding')).toBeLessThan(r('typescript'))
  })

  it('keeps every leaf inside its own attribute wedge', () => {
    // Two attributes whose fans overlapped would be unreadable and unclickable.
    // Compared as an angular distance, because atan2 wraps at pi and raw
    // comparison across the wrap says nothing.
    const nodes = loadYaml()
    const attributes = nodes.filter((n) => !n.parent)
    const halfWedge = Math.PI / attributes.length

    const angle = (id: string) => Math.atan2(byId.get(id)!.y, byId.get(id)!.x)
    const apart = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

    const attributeOf = (id: string): string => {
      const node = nodes.find((n) => n.id === id)!
      return node.parent ? attributeOf(node.parent) : node.id
    }

    for (const leaf of placed.filter((p) => p.ring === 'leaf')) {
      // The ellipse skews the attribute's own angle, so compare against the
      // wedge centre the layout used rather than against the plotted node.
      const i = attributes.findIndex((a) => a.id === attributeOf(leaf.id))
      const centre = -Math.PI / 2 + i * ((Math.PI * 2) / attributes.length)
      expect(apart(angle(leaf.id), centre), leaf.id).toBeLessThanOrEqual(halfWedge)
    }
  })

  it('survives a tree with one attribute and one leaf', () => {
    const tiny = layout([
      { id: 'a', name: 'A' },
      { id: 'b', parent: 'a', name: 'B' },
    ])
    expect(tiny).toHaveLength(3)
    expect(tiny.find((p) => p.id === 'b')!.ring).toBe('leaf')
  })

  it('survives an empty tree', () => {
    expect(layout([])).toEqual([{ id: ROOT_ID, x: 0, y: 0, ring: 'root' }])
  })
})

describe('nodeRadius', () => {
  it('grows with level and stops growing', () => {
    expect(nodeRadius('leaf', 5)).toBeGreaterThan(nodeRadius('leaf', 0))
    expect(nodeRadius('leaf', 99)).toBe(nodeRadius('leaf', 20))
  })

  it('ranks the rings', () => {
    expect(nodeRadius('root', 0)).toBeGreaterThan(nodeRadius('attribute', 0))
    expect(nodeRadius('attribute', 0)).toBeGreaterThan(nodeRadius('leaf', 0))
  })
})
