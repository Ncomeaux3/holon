'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { HIT as HIT_AREA } from '@/components/pos/button-classes'
import { cn } from '@/lib/utils'
import land from '../land.json'
import { R, clampView, flat, graticule, landPath, project, visible, zoomAt, type Half, type Ring, type Rotation, type View } from '../globe'

// The globe: filled continents with country borders on a tinted, lit sphere
// (2026-09-13, in place of the artboard's dot matrix), a pin per place
// coloured by what it is, the legend bottom left, the four controls bottom
// right and an alert top right when there is one. It opens level on the
// continental US. Drag to turn it (or pan, flat), scroll, pinch or the
// buttons to zoom about the cursor, ⟲ to reset, FLAT to unroll it,
// double-click a pin to fly to it. Past 2x every pin names itself, at the
// same size on screen whatever the zoom.
//
// No d3, no topojson, no world-atlas: see ../globe.ts.

export type PinKind = 'upcoming' | 'past' | 'wishlist'
export type Pin = { id: string; name: string; country: string; lat: number; lon: number; kind: PinKind }

const RINGS = land as Ring[]
const HOME: View = { zoom: 1, tx: 0, ty: 0 }
/** Level, centred on the continental US. Reset comes back here too. */
const LEVEL: Rotation = { lambda: 98, phi: 0 }
/** The flat land is drawn once, unpanned, and shifted with a transform. */
const FLAT_LAND = landPath(RINGS, { lambda: 0, phi: 0 }, 'flat')
/** The zoom from which every pin is named. Below it only the next trip is. */
const LABEL_ZOOM = 2
/** A label's height on screen, in pixels. */
const LABEL_PX = 9
/** A pin's hit radius in viewBox units at 1x: 7.5 units is about 12px on screen, a 24px target. */
const HIT = 7.5
/** How far a pointer travels before a press becomes a drag, in client pixels. */
const DRAG_PX = 4

/** Client pixels to viewBox units, so a zoom can anchor on the cursor. */
function toBox(svg: SVGSVGElement, clientX: number, clientY: number) {
  const m = svg.getScreenCTM()
  if (!m) return { x: 0, y: 0 }
  const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse())
  return { x: p.x, y: p.y }
}

/**
 * Screen pixels per viewBox unit, and half of what the svg shows in units.
 * The viewBox is letterboxed into the box rather than stretched, so on a
 * tall phone the flat map shows less than its box and the clamp must know.
 */
function measure(svg: SVGSVGElement): { scale: number; half: Half } {
  const m = svg.getScreenCTM()
  const scale = m?.a || 1
  return { scale, half: { x: svg.clientWidth / 2 / scale, y: svg.clientHeight / 2 / scale } }
}

export function Globe({
  pins,
  onPick,
  alert,
  className,
}: {
  pins: Pin[]
  onPick?: (id: string) => void
  /** The band top right: an unread travel notification, or nothing. */
  alert?: ReactNode
  className?: string
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [rotation, setRotation] = useState<Rotation>(LEVEL)
  const [view, setView] = useState<View>(HOME)
  const [mode, setMode] = useState<'globe' | 'flat'>('globe')
  // Every pointer that is down, where it last was. One turns, two pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  // Where the first pointer went down, and whether it has moved far enough
  // to count as a drag. A finger that wobbles on a pin is a tap.
  const start = useRef<{ x: number; y: number } | null>(null)
  const dragged = useRef(false)
  const [{ scale, half }, setBox] = useState<ReturnType<typeof measure>>({ scale: 1, half: { x: R + 4, y: R + 4 } })

  // Measured on mount, on resize and when the viewBox changes with the mode.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const update = () => setBox(measure(svg))
    update()
    const watch = new ResizeObserver(update)
    watch.observe(svg)
    return () => watch.disconnect()
  }, [mode])

  // React registers wheel listeners as passive, which cannot stop the page
  // scrolling under the globe. A native one can.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const { x, y } = toBox(svg, e.clientX, e.clientY)
      // The same sign as the skill tree, so one gesture zooms the whole app
      // the same way. A mouse notch is about a sixth and a trackpad tick well
      // under a hundredth, so a gesture is gradual rather than a jump to the
      // limit.
      setView((v) => zoomAt(v, Math.exp(-e.deltaY * 0.0015), x, y, mode, half))
    }
    svg.addEventListener('wheel', wheel, { passive: false })
    return () => svg.removeEventListener('wheel', wheel)
  }, [mode, half])

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    if (!dragged.current) {
      const from = start.current ?? prev
      if (Math.hypot(e.clientX - from.x, e.clientY - from.y) < DRAG_PX) return
      dragged.current = true
    }
    const svg = e.currentTarget
    const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1]
    if (other) {
      // A pinch: zoom by how much the two fingers spread, about their midpoint.
      const before = Math.hypot(prev.x - other.x, prev.y - other.y)
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y)
      const mid = toBox(svg, (e.clientX + other.x) / 2, (e.clientY + other.y) / 2)
      if (before > 0) setView((v) => zoomAt(v, after / before, mid.x, mid.y, mode, half))
    } else {
      // A hand on the globe: the land under the pointer goes where the pointer goes.
      const speed = 0.5 / view.zoom
      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y
      setRotation((r) => ({
        lambda: r.lambda + dx * speed,
        // Clamped, so the globe cannot be tipped past its pole. Flat pans instead.
        phi: mode === 'globe' ? Math.max(-90, Math.min(90, r.phi + dy * speed)) : r.phi,
      }))
      if (mode === 'flat') {
        const was = toBox(svg, prev.x, prev.y)
        const now = toBox(svg, e.clientX, e.clientY)
        setView((v) => clampView({ ...v, ty: v.ty + (now.y - was.y) }, 'flat', half))
      }
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }
  const lift = (e: React.PointerEvent) => pointers.current.delete(e.pointerId)

  const zoomBy = (factor: number) => setView((v) => zoomAt(v, factor, 0, 0, mode, half))
  const reset = () => {
    setRotation(LEVEL)
    setView(HOME)
  }
  const flyTo = (pin: Pin) => {
    setRotation({ lambda: -pin.lon, phi: mode === 'globe' ? pin.lat : 0 })
    setView({ ...HOME, zoom: 2 })
  }

  const place = (p: Pin) => (mode === 'globe' ? project(p.lon, p.lat, rotation) : flat(p.lon, p.lat, rotation))
  const shown = mode === 'globe' ? pins.filter((p) => visible(p.lon, p.lat, rotation)) : pins
  const box = mode === 'globe' ? `${-R - 4} ${-R - 4} ${(R + 4) * 2} ${(R + 4) * 2}` : `${-R * 2} ${-R} ${R * 4} ${R * 2}`
  const zoom = view.zoom
  const font = LABEL_PX / (zoom * scale)

  return (
    <div className={cn('relative h-full w-full', className)}>
      <svg
        ref={svgRef}
        viewBox={box}
        // A group, not an img: an img hides its children and the pins are buttons.
        role="group"
        aria-label={`Globe showing ${pins.length} places`}
        // Same opt-out as the constellation: this canvas handles its own
        // pointers, so the page-level pull and edge-back stay out of it. The
        // globe never sits at the top of the phone screen, so it has not
        // needed this, but one rule for both canvases beats two.
        data-gesture-surface=""
        // No pointer capture: with it a click on a pin lands on the svg
        // instead of the pin, so a pin could never be picked.
        onPointerDown={(e) => {
          if (e.isPrimary) {
            start.current = { x: e.clientX, y: e.clientY }
            dragged.current = false
          }
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        }}
        onPointerMove={move}
        onPointerUp={lift}
        onPointerCancel={lift}
        onPointerLeave={lift}
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${zoom})`}>
          {mode === 'globe' ? (
            <>
              <defs>
                {/* Lit from the upper left: clear there, shading to the dark at the rim. */}
                <radialGradient id="globe-light" cx="35%" cy="35%" r="70%">
                  <stop offset="0" stopColor="var(--shade)" stopOpacity={0} />
                  <stop offset="0.6" stopColor="var(--shade)" stopOpacity={0.15} />
                  <stop offset="1" stopColor="var(--shade)" stopOpacity={0.55} />
                </radialGradient>
                <radialGradient id="globe-rim" cx="50%" cy="50%" r="50%">
                  <stop offset={R / (R + 5) - 0.02} stopColor="var(--accent)" stopOpacity={0} />
                  <stop offset={R / (R + 5)} stopColor="var(--accent)" stopOpacity={0.25} />
                  <stop offset="1" stopColor="var(--accent)" stopOpacity={0} />
                </radialGradient>
              </defs>
              <circle cx={0} cy={0} r={R + 5} fill="url(#globe-rim)" pointerEvents="none" />
              <circle cx={0} cy={0} r={R} fill={OCEAN} stroke="var(--opaque-separator)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              {graticule(rotation).map((d, i) => (
                <path key={i} transform={`scale(${R})`} d={d} fill="none" stroke="var(--separator)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              ))}
              {/* The land: every ring filled and outlined, cut at the horizon, in the unit circle scaled up. */}
              <path data-land transform={`scale(${R})`} d={landPath(RINGS, rotation, 'globe')} {...LAND} />
              <circle cx={0} cy={0} r={R} fill="url(#globe-light)" pointerEvents="none" />
            </>
          ) : (
            <>
              <defs>
                <clipPath id="flat-box">
                  <rect x={-R * 2} y={-R} width={R * 4} height={R * 2} />
                </clipPath>
                {/* Styled here, not on the group: vector-effect does not inherit through a use. */}
                <path id="flat-land" transform={`scale(${R * 2})`} d={FLAT_LAND} {...LAND} />
              </defs>
              <rect x={-R * 2} y={-R} width={R * 4} height={R * 2} fill={OCEAN} stroke="var(--opaque-separator)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              {/* Panned by the same shift `flat()` gives the pins, wrapped like it is so the copy either side always covers the seam. */}
              <g clipPath="url(#flat-box)">
                <g transform={`translate(${((((rotation.lambda + 180) % 360) + 360) % 360 - 180) / 180 * 2 * R} 0)`}>
                  <use href="#flat-land" x={-4 * R} />
                  <use href="#flat-land" />
                  <use href="#flat-land" x={4 * R} />
                </g>
              </g>
            </>
          )}

          {shown.map((pin) => {
            const { x, y } = place(pin)
            const s = mode === 'globe' ? R : R * 2
            // Rounded: the server's and the browser's sin can differ in the last
            // digit, and React reports that as a hydration mismatch.
            const cx = +(x * s).toFixed(3)
            const cy = +(y * s).toFixed(3)
            const title = pin.country ? `${pin.name}, ${pin.country}` : pin.name
            return (
              <g
                key={pin.id}
                data-pin={pin.kind}
                role={onPick ? 'button' : undefined}
                tabIndex={onPick ? 0 : undefined}
                aria-label={onPick ? title : undefined}
                className={onPick ? 'cursor-pointer' : undefined}
                onClick={() => {
                  if (!dragged.current) onPick?.(pin.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onPick?.(pin.id)
                  }
                }}
                onDoubleClick={() => flyTo(pin)}
              >
                <title>{title}</title>
                {/* The target: about 24px across on screen whatever the zoom, so a finger lands. */}
                <circle cx={cx} cy={cy} r={HIT / zoom} fill="transparent" />
                {pin.kind === 'wishlist' ? (
                  <circle cx={cx} cy={cy} r={3.5 / zoom} fill="none" stroke="var(--label)" strokeWidth={1} strokeDasharray="1.5 1.5" vectorEffect="non-scaling-stroke" />
                ) : (
                  <circle cx={cx} cy={cy} r={(pin.kind === 'upcoming' ? 4 : 3.5) / zoom} fill={pin.kind === 'upcoming' ? 'var(--accent)' : 'var(--secondary-label)'} stroke="var(--gray-5)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                )}
                {/* Named at a fixed size on screen: the text is divided by the zoom the group multiplies by. */}
                {(pin.kind === 'upcoming' || zoom >= LABEL_ZOOM) && (
                  <text
                    data-label
                    x={cx + 6 / zoom}
                    y={cy - 5 / zoom}
                    fontSize={font}
                    letterSpacing={font / 12}
                    fill="var(--label)"
                    className="uppercase"
                  >
                    {pin.name}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>

      {alert && <div className="absolute right-3 top-3 max-w-[min(360px,70%)]">{alert}</div>}

      {/* Below md the legend takes its own line above the controls; the band is too narrow for both corners. */}
      <div className="pointer-events-none absolute bottom-2.5 left-3 flex flex-wrap gap-3.5 text-caption-2 uppercase tracking-[0.06em] text-secondary-label max-md:bottom-[42px]">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-accent" />Upcoming</span>
        <span className="flex items-center gap-1.5"><span className="size-[7px] rounded-full bg-secondary-label" />Past</span>
        <span className="flex items-center gap-1.5"><span className="size-[7px] rounded-full border border-dashed border-label" />Wishlist</span>
      </div>

      <div className="absolute bottom-2.5 right-3 flex gap-1">
        {(
          [
            ['+', 'Zoom in', () => zoomBy(1.5)],
            ['−', 'Zoom out', () => zoomBy(1 / 1.5)],
            ['⟲', 'Reset view', reset],
          ] as const
        ).map(([glyph, label, act]) => (
          <button key={label} type="button" aria-label={label} title={label} onClick={act} className={control}>
            {glyph}
          </button>
        ))}
        <button
          type="button"
          aria-label={mode === 'globe' ? 'Flat' : 'Globe'}
          title="Globe / flat"
          onClick={() => {
            setMode((m) => (m === 'globe' ? 'flat' : 'globe'))
            setView(HOME)
          }}
          className={cn(control, 'label w-auto px-2 text-caption-2 tracking-[0.08em]')}
        >
          {mode === 'globe' ? 'Flat' : 'Globe'}
        </button>
      </div>
    </div>
  )
}

/** Filled land with borders, for the globe path and the flat one. */
const LAND = {
  fill: 'var(--secondary-label)',
  fillRule: 'evenodd',
  stroke: 'var(--gray)',
  strokeWidth: 0.6,
  vectorEffect: 'non-scaling-stroke',
} as const
/** The sea: a little accent mixed into the deep background, since there is no blue token. */
const OCEAN = 'color-mix(in srgb, var(--accent) 18%, var(--gray-5))'

// 26px drawn, 44px to the pointer through HIT.
const control = cn(
  HIT_AREA,
  'grid size-[26px] place-items-center rounded-full border border-opaque-separator bg-grouped-2 text-footnote text-secondary-label transition-colors duration-150 hover:border-label hover:text-label',
)
