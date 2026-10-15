import type { SkillNode } from '../tree'

// Deterministic placement, not a force simulation. The prototype's constellation
// is the same every time it loads, which is what makes a skill findable twice.
// See docs/plans/design-build.md decision 8: no d3-force.

export type Ring = 'root' | 'attribute' | 'category' | 'leaf'
export type Placed = { id: string; x: number; y: number; ring: Ring; parent?: string }

export const ROOT_ID = '__you'

/**
 * The canvas the tree is placed in, landscape as the artboard has it.
 *
 * A square box was the reason the constellation sat in a small island in the
 * middle of a wide canvas: fitted xMidYMid meet, a square viewBox in a
 * landscape container scales by the height and leaves the width empty.
 */
export const VIEW_W = 1200
export const VIEW_H = 760

const ATTR_RX = 150
const ATTR_RY = 120
const LEAF_R = 330
/** Every other leaf pushed out, so adjacent labels do not collide. */
const LEAF_STAGGER = 34
/** The ellipse the whole outer ring is drawn on: wide and short, to fill the box. */
const LEAF_KX = 1.15
const LEAF_KY = 0.86
/**
 * How much of its wedge an attribute's fan uses.
 *
 * Under the ellipse an angle near the vertical opens up by about a third, so
 * the fans of the top attribute would cross into its neighbours at the
 * artboard's 0.82. This is the widest fan that still lands inside the wedge
 * after the skew, which is what layout.test.ts checks.
 */
const SPREAD = 0.75

/**
 * Three decimals. The server and the browser disagree in the last bits of
 * cos and sin, and React reported every edge and transform as a hydration
 * mismatch; a thousandth of a unit is under a hundredth of a pixel.
 */
const round = (n: number) => Math.round(n * 1000) / 1000

const at = (angle: number, rx: number, ry: number) => ({
  x: round(Math.cos(angle) * rx),
  y: round(Math.sin(angle) * ry),
})

/**
 * Root at the centre, attributes on an ellipse, every leaf fanned on an outer
 * arc inside its attribute's wedge, and each category at the midpoint between
 * its attribute and its own leaves.
 *
 * Leaves are found by having no children rather than by depth, because the
 * committed tree is uneven: Engineering has categories, Health does not.
 */
export function layout(nodes: SkillNode[]): Placed[] {
  const childrenOf = new Map<string, SkillNode[]>()
  for (const node of nodes) {
    if (!node.parent) continue
    childrenOf.set(node.parent, [...(childrenOf.get(node.parent) ?? []), node])
  }

  const attributes = nodes.filter((n) => !n.parent)
  const placed: Placed[] = [{ id: ROOT_ID, x: 0, y: 0, ring: 'root' }]
  if (attributes.length === 0) return placed

  const wedge = (Math.PI * 2) / attributes.length

  attributes.forEach((attribute, i) => {
    // Start at the top and go clockwise, so the first attribute in the file is
    // where the eye lands.
    const centre = -Math.PI / 2 + i * wedge
    placed.push({ id: attribute.id, ...at(centre, ATTR_RX, ATTR_RY), ring: 'attribute' })

    const descendants = (id: string): SkillNode[] =>
      (childrenOf.get(id) ?? []).flatMap((c) => [c, ...descendants(c.id)])
    const leaves = descendants(attribute.id).filter((n) => !childrenOf.has(n.id))

    const span = wedge * SPREAD
    const positions = new Map<string, { x: number; y: number }>()

    leaves.forEach((leaf, j) => {
      // One leaf sits on the wedge's centre line rather than at its edge.
      const t = leaves.length === 1 ? 0 : j / (leaves.length - 1) - 0.5
      const angle = centre + t * span
      const radius = LEAF_R + (j % 2) * LEAF_STAGGER
      const point = at(angle, radius * LEAF_KX, radius * LEAF_KY)
      positions.set(leaf.id, point)
      placed.push({ id: leaf.id, ...point, ring: 'leaf', parent: leaf.parent })
    })

    for (const category of childrenOf.get(attribute.id) ?? []) {
      if (!childrenOf.has(category.id)) continue
      const own = descendants(category.id)
        .map((n) => positions.get(n.id))
        .filter((p): p is { x: number; y: number } => Boolean(p))
      if (own.length === 0) continue

      const mean = {
        x: own.reduce((s, p) => s + p.x, 0) / own.length,
        y: own.reduce((s, p) => s + p.y, 0) / own.length,
      }
      const attr = placed.find((p) => p.id === attribute.id)!
      placed.push({
        id: category.id,
        x: round((attr.x + mean.x) / 2),
        y: round((attr.y + mean.y) / 2),
        ring: 'category',
        parent: category.parent,
      })
    }
  })

  return placed
}

/**
 * Node radius, in the artboard's ratios.
 *
 * Only a leaf grows with its level, and it stops at Lv 20. The rings above it
 * are fixed, because their size is what says which ring they are: attributes
 * that grew past their root read as a flat field of blobs, which is what the
 * old `base + level * 0.45` on every ring produced.
 */
export function nodeRadius(ring: Ring, level: number): number {
  if (ring === 'root') return 14
  if (ring === 'attribute') return 9
  if (ring === 'category') return 6
  return 3.5 + Math.min(4, Math.max(0, level) * 0.55)
}
