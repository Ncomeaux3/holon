'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@/lib/utils'
import type { SkillStat } from '../data'
import type { SkillNode } from '../tree'
import { layout, nodeRadius, ROOT_ID, VIEW_H, VIEW_W, type Placed } from './layout'
import { FLY_MS, flyAt, labelScale, pinch, viewPoint, zoomBy, zoomStep, ZOOM_MAX, type View } from './view'

// Obsidian style, but placed rather than simulated: see ./layout.ts.

/**
 * The sky is night in both themes, so the chrome on it names its own label
 * colours: the constellation's blue greys and the dark orange. `color-scheme:
 * dark` on the pane left the tokens light (measured 1.06:1 on the hover card).
 */
export const SKY =
  '[--label:#cfe6ff] [--secondary-label:#8fa3b8] [--orange:rgb(255_146_48)] [--orange-text:rgb(255_160_86)]'

const HOME: View = { zoom: 1, pan: { x: 0, y: 0 } }

/** How far a pointer travels before a press becomes a pan. The globe's slop. */
const DRAG_PX = 4

export type Tone = 'gaining' | 'active' | 'stagnant'

/** Gaining beats stagnant: a skill worked on this month is not stagnant. */
export function toneFor(stat: SkillStat | undefined, now: number): Tone {
  if (!stat) return 'stagnant'
  if (stat.gained30d > 0) return 'gaining'
  if (!stat.lastEventAt) return 'stagnant'
  return Date.parse(stat.lastEventAt) > now - 60 * 24 * 60 * 60 * 1000 ? 'active' : 'stagnant'
}

/**
 * The node palette, taken from the design bundle rather than invented.
 *
 * The important part is what is *not* accent. Every node used to be teal,
 * which is why the constellation read as one flat colour: accent is reserved
 * for a skill gaining fast, so it means something when you see it. Everything
 * else is a pale blue star, and a stagnant one is a dim slate.
 */
const TONE_FILL: Record<Tone, string> = {
  gaining: 'var(--accent)',
  active: '#9fd1ff',
  stagnant: '#5b6b7d',
}

/** Label sizes by ring, off the artboard. */
/** The XP at which the next level starts. Mirrors modules/skills/xp.ts. */
const nextXp = (level: number) => (level + 1) * (level + 1) * 100
/** How far through the current level, for the card's bar. */
const levelPercent = (xp: number, level: number) => {
  const floor = level * level * 100
  return Math.max(0, Math.min(100, ((xp - floor) / (nextXp(level) - floor)) * 100))
}

const LABEL_SIZE: Record<string, number> = {
  root: 13,
  attribute: 12,
  category: 10.5,
  leaf: 9.5,
}

/**
 * A label's size and offset from the zoom, in CSS rather than in render.
 *
 * `--ts` is written on the group once per frame (see `apply`): the font grows
 * by it, and the offset by it only past 1, so zooming out never pulls a label
 * into its star.
 */
function labelStyle(offset: number, size: number) {
  return {
    fontSize: `calc(${size}px * var(--ts, 1))`,
    transform: `translateY(calc(${offset}px * max(1, var(--ts, 1))))`,
  }
}

/** The blurred bloom behind a node. Accent only when it is gaining. */
const HALO_COLOR: Record<Tone, string> = {
  gaining: 'var(--accent)',
  active: '#4aa3ff',
  stagnant: '#4aa3ff',
}

/**
 * A deterministic starfield.
 *
 * Seeded rather than random: a new field on every render would flicker on
 * hover, and the server and client markup have to agree or React complains
 * about the mismatch.
 */
function starfield(count: number, seed: number) {
  const out: { x: number; y: number; r: number; delay: number; period: number }[] = []
  let n = seed
  const next = () => {
    // Numerical Recipes LCG. Small, deterministic, and good enough for dust.
    n = (n * 1664525 + 1013904223) % 4294967296
    return n / 4294967296
  }
  for (let i = 0; i < count; i++) {
    out.push({
      x: next() * VIEW_W - VIEW_W / 2,
      y: next() * VIEW_H - VIEW_H / 2,
      r: 0.4 + next() * 1.1,
      delay: next() * 3,
      period: 2 + next() * 4,
    })
  }
  return out
}

export function Constellation({
  nodes,
  stats,
  selected,
  onSelect,
  characterLevel,
  now,
  onReassign,
  resetToken,
}: {
  nodes: SkillNode[]
  stats: SkillStat[]
  selected: string | null
  onSelect: (id: string | null) => void
  characterLevel: number
  /** From the server. A clock read during render is impure and unstable. */
  now: number
  onReassign?: (entityRef: string, fromSkillId: string, toSkillId: string) => void
  /** Bumped by the band's Reset view; pan and zoom go back to the start. */
  resetToken?: number
}) {
  const placed = useMemo(() => layout(nodes), [nodes])
  const statById = useMemo(() => new Map(stats.map((s) => [s.id, s])), [stats])

  /**
   * Pan and zoom never touch React state.
   *
   * A trackpad sends many wheel events per frame. When these were state, the
   * wheel effect that depended on them was torn down and re-attached after
   * every commit, so every event that landed before the commit read the old
   * zoom and the burst collapsed to one step: the jump. And each event
   * re-rendered a hundred blurred stars: the stutter. Now the view lives in a
   * ref, the group is written once per animation frame, and nothing else
   * re-renders on a zoom.
   */
  const view = useRef<View>(HOME)
  const group = useRef<SVGGElement>(null)
  const frame = useRef(0)
  const still = useRef(0)
  const apply = useCallback(() => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const g = group.current
      if (!g) return
      const { zoom, pan } = view.current
      g.setAttribute('transform', `scale(${zoom}) translate(${pan.x} ${pan.y})`)
      g.style.setProperty('--ts', String(labelScale(zoom)))
      // Zoomed out far enough that a leaf's own name is already crowding its
      // neighbours, the second line comes off (a CSS rule on this attribute).
      g.toggleAttribute('data-far', zoom < 0.91)
      // The glow filters cost 25ms a frame at Retina scale, against 8ms
      // without them, so they come off while the view is in motion (a CSS
      // rule on this attribute) and back the moment it has been still.
      g.setAttribute('data-moving', '')
      clearTimeout(still.current)
      still.current = window.setTimeout(() => g.removeAttribute('data-moving'), 120)
    })
  }, [])
  /** A double-click flies rather than cuts: the view eased to a target over
   * FLY_MS, one frame at a time. Any wheel or drag cancels it. */
  const flight = useRef(0)
  const fly = useCallback(
    (to: View) => {
      cancelAnimationFrame(flight.current)
      const from = view.current
      const began = performance.now()
      const step = (now: number) => {
        const t = (now - began) / FLY_MS
        view.current = flyAt(from, to, t)
        apply()
        flight.current = t < 1 ? requestAnimationFrame(step) : 0
      }
      flight.current = requestAnimationFrame(step)
    },
    [apply],
  )
  const settle = useCallback(() => {
    cancelAnimationFrame(flight.current)
    flight.current = 0
  }, [])
  const [hover, setHover] = useState<{ node: Placed; x: number; y: number; width: number; height: number } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  // Every pointer that is down, where it last was. One pans, two pinch. The
  // globe has kept this shape since it was built; the tree kept a single drag
  // origin, so a second finger overwrote the first and there was no pinch to
  // be had (v1.1 Phase 8).
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  // Where the first pointer went down, and whether it has moved far enough to
  // count as a drag. A finger that wobbles on a star is a tap.
  const start = useRef<{ x: number; y: number } | null>(null)
  const dragged = useRef(false)
  /** True from the moment a pan starts until the click it would produce is
   * swallowed, so letting go after dragging does not also select a node. */
  const panned = useRef(false)

  const lift = (e: ReactPointerEvent) => pointers.current.delete(e.pointerId)

  const svg = useRef<SVGSVGElement>(null)

  /**
   * Wheel to zoom, on a listener of our own, attached once.
   *
   * React attaches onWheel passively, so a handler there cannot stop the page
   * scrolling behind the canvas: zooming in would also walk the page down,
   * which is most of what made this feel slippery. Native and non-passive is
   * the only way to hold the page still.
   */
  useEffect(() => {
    const el = svg.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      settle()
      view.current = zoomStep(view.current, e.deltaY, e.deltaMode, viewPoint(el, e.clientX, e.clientY))
      apply()
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      cancelAnimationFrame(frame.current)
      frame.current = 0
      settle()
      clearTimeout(still.current)
    }
  }, [apply, settle])

  const edges = placed.filter((p) => p.id !== ROOT_ID)
  const positionOf = (id: string) => placed.find((p) => p.id === id)

  // The band owns the Reset view button, as the artboard has it, so the reset
  // arrives as a changed token rather than a click in here.
  useEffect(() => {
    view.current = HOME
    apply()
  }, [resetToken, apply])

  // The root is not a stat row: its children are the attributes, and its card
  // is the character, summed from them.
  const childrenOf = useCallback(
    (id: string) => stats.filter((s) => (id === ROOT_ID ? !s.parent : s.parent === id)),
    [stats],
  )
  const you = useMemo<SkillStat>(() => {
    const attributes = stats.filter((s) => !s.parent)
    return {
      id: ROOT_ID,
      name: 'You',
      keywords: [],
      ownXp: 0,
      xp: attributes.reduce((sum, a) => sum + a.xp, 0),
      level: characterLevel,
      gained30d: attributes.reduce((sum, a) => sum + a.gained30d, 0),
      lastEventAt: null,
      goalWeight: 0,
    }
  }, [stats, characterLevel])
  const hovered = hover ? (hover.node.id === ROOT_ID ? you : statById.get(hover.node.id)) : undefined
  const branches = hover ? childrenOf(hover.node.id) : []

  /**
   * What lights up while a star is hovered: the path back to the root, its own
   * branches, and theirs. Everything else dims. This is the artboard's rule,
   * and it is what makes hovering an attribute show you its whole limb.
   */
  const related = useMemo(() => {
    const out = new Set<string>()
    if (!hover) return out

    for (let id: string | undefined = hover.node.id; id; id = statById.get(id)?.parent) {
      out.add(id)
    }
    // An attribute has no parent row, so the walk stops one short of the
    // centre: without this the last edge never lit and You dimmed.
    out.add(ROOT_ID)
    for (const child of childrenOf(hover.node.id)) {
      out.add(child.id)
      for (const leaf of childrenOf(child.id)) out.add(leaf.id)
    }
    return out
  }, [hover, childrenOf, statById])

  const dimmed = (id: string) => hover !== null && !related.has(id)

  // Seeded once. A field regenerated per render would flicker on every hover.
  const stars = useMemo(() => starfield(140, 20260909), [])

  /**
   * One haze per attribute, pushed out past its own star.
   *
   * These used to be five circles at random points in the box, which is what
   * put soft green discs in empty sky with nothing under them. Anchored to the
   * attributes they are what the artboard draws: a bloom around the tree,
   * brightest where the tree actually is.
   */
  const nebulae = useMemo(
    () =>
      placed
        .filter((p) => p.ring === 'attribute')
        .map((p) => ({ x: p.x * 2.25, y: p.y * 2.25 })),
    [placed],
  )

  return (
    // On a phone the sky is exactly as tall as the view box fitted to its
    // width (VIEW_W by VIEW_H in ./layout.ts): a fixed minimum left empty sky
    // under the leaves and pushed the columns under the tab bar. From md it
    // fills whatever the pane leaves it.
    <div className="relative flex aspect-[1200/760] flex-none flex-col md:aspect-auto md:min-h-[320px] md:flex-1">
      {/* Absolutely positioned, as the artboard's is, and not for the look:
        * an svg in normal flow with a percentage height dirties layout up its
        * containing-block chain whenever its own layout is invalidated, and
        * every transform write is such an invalidation. In flow, each zoom
        * frame laid out the whole page (about 60ms on a Retina 120Hz screen,
        * 55 long tasks in a one second gesture); absolute, none. */}
      <svg
        ref={svg}
        role="img"
        aria-label="Skill constellation"
        // This canvas handles its own pointers: PullToRefresh and useEdgeBack
        // both step aside for a drag that starts in here.
        data-gesture-surface=""
        viewBox={`${-VIEW_W / 2} ${-VIEW_H / 2} ${VIEW_W} ${VIEW_H}`}
        className="absolute inset-0 h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        // No pointer capture: with it a tap on a star lands on the svg rather
        // than the star, so a star could never be picked. `panned` is what
        // keeps a pan from also selecting, and it does not need capture.
        onPointerDown={(e) => {
          settle()
          if (e.isPrimary) {
            start.current = { x: e.clientX, y: e.clientY }
            dragged.current = false
            panned.current = false
          }
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        }}
        onPointerMove={(e) => {
          const prev = pointers.current.get(e.pointerId)
          if (!prev) return

          if (!dragged.current) {
            const from = start.current ?? prev
            if (Math.hypot(e.clientX - from.x, e.clientY - from.y) < DRAG_PX) return
            dragged.current = true
            panned.current = true
          }

          const el = e.currentTarget
          const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1]
          if (other) {
            // A pinch: zoom by how much the two fingers spread, about their
            // midpoint, so the tree grows where the hand is.
            const before = Math.hypot(prev.x - other.x, prev.y - other.y)
            const after = Math.hypot(e.clientX - other.x, e.clientY - other.y)
            view.current = pinch(
              view.current,
              before,
              after,
              viewPoint(el, (e.clientX + other.x) / 2, (e.clientY + other.y) / 2),
            )
          } else {
            // Screen pixels to translate units: through the fitted scale, then
            // through the zoom the group applies after the translate.
            const units = 1 / (viewPoint(el, 0, 0).scale * view.current.zoom)
            view.current = {
              zoom: view.current.zoom,
              pan: {
                x: view.current.pan.x + (e.clientX - prev.x) * units,
                y: view.current.pan.y + (e.clientY - prev.y) * units,
              },
            }
          }

          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          apply()
        }}
        onPointerUp={lift}
        onPointerCancel={lift}
        onPointerLeave={lift}
        // Clicking the space between stars clears the selection, the way
        // clicking off a row does everywhere else.
        onClick={() => {
          if (panned.current) {
            panned.current = false
            return
          }
          onSelect(null)
        }}
        onDoubleClick={(e) => {
          fly(zoomBy(view.current, 1.5, viewPoint(e.currentTarget, e.clientX, e.clientY)))
        }}
      >
        <defs>
          {/* The bloom on a node itself: blurred copy merged back under the
            * crisp shape, so the star keeps a hard edge and still glows. */}
          <filter id="skill-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* The wide halo. No merge: this one is only the blur. */}
          <filter id="skill-glow-big" x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="18" />
          </filter>
          <radialGradient id="skill-neb">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.18" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Dust, behind the pan and zoom so the field stays put while the
          * tree moves over it. Depth without parallax. */}
        {stars.map((s, i) => (
          <circle
            key={i}
            cx={s.x}
            cy={s.y}
            r={s.r}
            fill="#cfe6ff"
            className="skill-twinkle"
            style={{ animationDelay: `${s.delay}s`, animationDuration: `${s.period}s` }}
          />
        ))}

        <g ref={group} className="skill-view" transform="scale(1) translate(0 0)">
          {/* The nebulae ride with the tree: each one is anchored to an
            * attribute, and a bloom that stayed put while its star zoomed away
            * read as a stain on the glass rather than light around the tree. */}
          {nebulae.map((n, i) => (
            <circle key={i} cx={n.x} cy={n.y} r={210} fill="url(#skill-neb)" />
          ))}
          {edges.map((node) => {
            const from = positionOf(node.parent ?? ROOT_ID)
            if (!from) return null
            const hot = hover !== null && related.has(node.id) && related.has(node.parent ?? ROOT_ID)
            return (
              <line
                key={`edge-${node.id}`}
                data-edge={node.id}
                x1={from.x}
                y1={from.y}
                x2={node.x}
                y2={node.y}
                // The artboard's three states: hot along the hovered limb,
                // dim everywhere else while something is hovered, and a
                // resting weight that depends on the depth.
                stroke={hot ? '#ffffff' : '#9fd1ff'}
                strokeWidth={hot ? 1.2 : 0.7}
                strokeOpacity={
                  hover === null
                    ? node.ring === 'leaf'
                      ? 0.32
                      : 0.55
                    : hot
                      ? 0.9
                      : 0.08
                }
                className="[transition:stroke-opacity_.2s,stroke-width_.2s]"
              />
            )
          })}

          {placed.map((node) => {
            const stat = statById.get(node.id)
            const isRoot = node.id === ROOT_ID
            const level = isRoot ? characterLevel : (stat?.level ?? 0)
            const r = nodeRadius(node.ring, level)
            // Accent is a leaf gaining fast, nothing else: the artboard's rule
            // is `n.leaf && d30 >= 50`, and its root and attributes are the
            // same pale blue as every other star.
            const tone = node.ring === 'leaf' ? toneFor(stat, now) : 'active'
            const isSelected = selected === node.id
            const isDrop = dropTarget === node.id
            const isHovered = hover?.node.id === node.id
            const dim = dimmed(node.id)

            return (
              <g
                key={node.id}
                data-skill={node.id}
                transform={`translate(${node.x} ${node.y})`}
                onPointerEnter={(e) => {
                  // Where the star actually is on screen, measured rather than
                  // reprojected, so the card follows it through pan and zoom.
                  const star = e.currentTarget.getBoundingClientRect()
                  const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect()
                  setHover({
                    node,
                    x: star.x + star.width / 2 - (box?.x ?? 0),
                    y: star.y + star.height / 2 - (box?.y ?? 0),
                    width: box?.width ?? 0,
                    height: box?.height ?? 0,
                  })
                }}
                onPointerLeave={() => setHover((h) => (h?.node.id === node.id ? null : h))}
                onClick={(e) => {
                  e.stopPropagation()
                  // A pan that ended on a node is not a click on it.
                  if (panned.current) {
                    panned.current = false
                    return
                  }
                  onSelect(isSelected ? null : node.id)
                }}
                // The artboard's double-click: fly to the node rather than
                // zooming wherever the pointer happens to be.
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  const z = view.current.zoom
                  fly({
                    zoom: Math.min(ZOOM_MAX, Math.max(1.6, z * 1.5)),
                    pan: { x: -node.x, y: -node.y },
                  })
                }}
                onDragOver={(e) => {
                  if (isRoot || !onReassign) return
                  e.preventDefault()
                  setDropTarget(node.id)
                }}
                onDragLeave={() => setDropTarget((t) => (t === node.id ? null : t))}
                onDrop={(e) => {
                  e.preventDefault()
                  setDropTarget(null)
                  if (isRoot || !onReassign) return
                  const payload = e.dataTransfer.getData('text/plain')
                  const [entityRef, fromSkillId] = payload.split('|')
                  if (entityRef && fromSkillId && fromSkillId !== node.id) {
                    onReassign(entityRef, fromSkillId, node.id)
                  }
                }}
                className="cursor-pointer"
              >
                {/* Four circles, which is what makes a node a star rather
                  * than a dot: a wide blurred halo, a ring that only appears
                  * when there is something to say, the body, and a white core.
                  * Sizes are the design bundle's ratios, not invented. */}
                <circle
                  r={r * 3.2}
                  fill={HALO_COLOR[tone]}
                  filter="url(#skill-glow-big)"
                  opacity={
                    dim
                      ? 0.05
                      : isRoot || node.ring === 'attribute' || tone === 'gaining' || isSelected
                        ? 0.7
                        : 0.22
                  }
                  className={cn(
                    'transition-opacity duration-200',
                    (tone === 'gaining' || isSelected) && 'skill-breathe',
                  )}
                />
                <circle
                  r={r + 5}
                  fill="none"
                  strokeWidth={isDrop ? 2 : 1}
                  opacity={0.8}
                  stroke={
                    isSelected || isDrop
                      ? 'var(--accent)'
                      : tone === 'stagnant'
                        ? 'var(--orange)'
                        : 'transparent'
                  }
                  // A dashed ring is how a stagnant skill says so without
                  // going grey, which the design forbids: greyed out items
                  // keep full opacity and change colour instead.
                  strokeDasharray={tone === 'stagnant' && !isSelected ? '2 3' : undefined}
                />
                {/* The hovered star grows by a third, which is the artboard's
                  * ratio and the thing that makes the pointer feel attached
                  * to it. */}
                <circle
                  r={r * (isHovered ? 1.3 : 1)}
                  fill={TONE_FILL[tone]}
                  filter="url(#skill-glow)"
                  opacity={dim ? 0.35 : 1}
                  className="transition-[r,opacity] duration-200"
                />
                <circle
                  r={r * 0.45 * (isHovered ? 1.3 : 1)}
                  fill="#ffffff"
                  opacity={dim ? 0.35 : 1}
                  className="transition-[r,opacity] duration-200"
                />
                {/* Name, then level under it, both in the artboard's sizes.
                  * The level line is the reason a star means anything at a
                  * glance: without it the tree is a field of unlabelled dots
                  * and every reading of it needs a click. */}
                <text
                  textAnchor="middle"
                  className="pointer-events-none transition-colors duration-200"
                  fill={dim ? '#3d4b5c' : isRoot || node.ring === 'attribute' ? '#ffffff' : '#cfe6ff'}
                  style={labelStyle(r + (isRoot ? 18 : 15), LABEL_SIZE[node.ring])}
                >
                  {isRoot ? 'You' : (stat?.name ?? node.id)}
                </text>
                <text
                  textAnchor="middle"
                  className={cn('label pointer-events-none', node.ring === 'leaf' && 'skill-far-hide')}
                  fill="#8fa3b8"
                  opacity={dim ? 0.35 : 1}
                  style={labelStyle(r + (isRoot ? 30 : 26), 8.5)}
                >
                  LV {level}
                  {!isRoot && (stat?.gained30d ?? 0) > 0
                    ? ` +${Math.round(stat!.gained30d).toLocaleString()}`
                    : ''}
                </text>
              </g>
            )
          })}
        </g>
      </svg>

      {/* The hover card, as the artboard draws it: centred under the star,
        * 18px below it, and only ever on demand. The legend is a normal block
        * under the svg, so nothing else overlays the tree.
        *
        * A leaf shows its XP against the next level with a bar, the month,
        * and its goal weight, then its keywords. A parent lists its children
        * and their levels instead. */}
      {hovered && hover && (
        <div
          data-testid="skill-hover-card"
          className={cn(SKY, '[--accent:#9bb9ff] pointer-events-none absolute z-20 min-w-[220px] max-w-[300px] animate-[skill-fadein_.12s_both] border border-white/18 bg-[rgba(6,10,16,.92)] px-3.5 py-3 backdrop-blur-[6px] rounded-card')}
          style={{
            // Centred on the star, but never past the canvas edge: half the
            // card's widest at each side.
            left: Math.max(150, Math.min(hover.width - 150, hover.x)),
            top: hover.y,
            // Above the star instead when it would land on the legend, which
            // sits over the bottom of the canvas: a card is up to 220px tall.
            transform:
              hover.y > hover.height - 300 ? 'translate(-50%, calc(-100% - 18px))' : 'translate(-50%, 18px)',
          }}
        >
          <div className="flex items-baseline justify-between gap-3 border-b border-white/12 pb-2">
            <span className="truncate text-subheadline text-white">{hovered.name}</span>
            <span className="num shrink-0 text-caption-1 text-secondary-label">
              Lv {hovered.level}
              {branches.length > 0 &&
                hover.node.id !== ROOT_ID &&
                ` · ${branches.length} ${hover.node.ring === 'attribute' ? 'branches' : 'skills'}`}
            </span>
          </div>

          {branches.length > 0 ? (
            <>
              <div className="mt-2 flex flex-col gap-[5px]">
                {branches.map((b) => (
                  <div key={b.id} className="flex justify-between gap-3 text-footnote text-label">
                    <span className="truncate">{b.name}</span>
                    <span className={cn('num shrink-0', b.gained30d > 0 ? 'text-white' : 'text-secondary-label')}>
                      Lv {b.level} ({Math.round(b.xp).toLocaleString()})
                    </span>
                  </div>
                ))}
              </div>
              <div className="label mt-2 text-caption-2 text-secondary-label">
                {hovered.gained30d > 0
                  ? `+${Math.round(hovered.gained30d).toLocaleString()} XP in 30 days`
                  : 'No XP in 30 days'}
              </div>
            </>
          ) : (
            <>
              <div className="mt-2 flex flex-col gap-[5px] text-footnote text-label">
                <div className="flex justify-between gap-3">
                  <span>XP</span>
                  <span className="num text-white">
                    {Math.round(hovered.xp).toLocaleString()} / {nextXp(hovered.level).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Last 30 days</span>
                  <span className={cn('num', hovered.gained30d > 0 ? 'text-accent' : 'text-orange-text')}>
                    {hovered.gained30d > 0 ? `+${Math.round(hovered.gained30d).toLocaleString()}` : 'idle'}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Goal weight</span>
                  <span className="num">{hovered.goalWeight.toFixed(1)}</span>
                </div>
              </div>
              <div className="mt-2.5 h-0.5 bg-white/12">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${levelPercent(hovered.xp, hovered.level)}%` }}
                />
              </div>
              <div className="label mt-2 text-caption-2 text-secondary-label">
                {hovered.keywords.slice(0, 4).join(' · ')}
              </div>
            </>
          )}
        </div>
      )}

    </div>
  )
}
