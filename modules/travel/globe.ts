// An orthographic projection, hand rolled. No imports.
//
// The land is modules/travel/land.json, the Natural Earth country polygons as
// rings decoded once by scripts/land-rings.mts, filled here and cut at the
// horizon by `ringPath`. d3-geo, topojson and world-atlas stay out of the
// bundle (2026-09-07); `project` and `ringPath` are the functions d3 would be
// replacing.

/** A closed list of [lon, lat]. */
export type Ring = [number, number][]

export type Rotation = {
  /** Degrees the globe is turned about its axis. Negative moves east into view. */
  lambda: number
  /** Degrees it is tilted. Positive brings the south into view. */
  phi: number
}

const RAD = Math.PI / 180

/**
 * Longitude and latitude to a point in the unit circle.
 *
 * Screen coordinates, so y grows downward and the north pole is negative. The
 * caller scales and centres; everything here stays in units of one radius so
 * the maths never has to know how big the drawing is.
 */
export function project(lon: number, lat: number, rotation: Rotation): { x: number; y: number } {
  const l = (lon + rotation.lambda) * RAD
  const p = lat * RAD
  const phi = rotation.phi * RAD

  const cosP = Math.cos(p)
  const x = cosP * Math.sin(l)
  const y = Math.cos(phi) * Math.sin(p) - Math.sin(phi) * cosP * Math.cos(l)

  return { x, y: -y }
}

/**
 * Whether a point is on the near side of the sphere.
 *
 * The z component of the same rotation. Zero is the exact silhouette, counted
 * as visible so a point sitting on the edge stays put rather than flickering as
 * a rounding error crosses the boundary.
 */
export function visible(lon: number, lat: number, rotation: Rotation): boolean {
  const l = (lon + rotation.lambda) * RAD
  const p = lat * RAD
  const phi = rotation.phi * RAD

  const z =
    Math.sin(phi) * Math.sin(p) + Math.cos(phi) * Math.cos(p) * Math.cos(l)
  return z >= 0
}

/**
 * The flat map: equirectangular into a 2 by 1 box, x in [-1, 1] and y in
 * [-0.5, 0.5], screen y down. `lambda` pans it the way it turns the globe.
 */
export function flat(lon: number, lat: number, rotation: Rotation): { x: number; y: number } {
  let l = lon + rotation.lambda
  while (l > 180) l -= 360
  while (l < -180) l += 360
  return { x: l / 180, y: -lat / 180 }
}

/**
 * The rotated point as a unit vector in view space: x right, y down on screen,
 * z toward the viewer. `project` and `visible` are its x, y and the sign of z.
 */
function toView(lon: number, lat: number, rotation: Rotation): [number, number, number] {
  const l = (lon + rotation.lambda) * RAD
  const p = lat * RAD
  const phi = rotation.phi * RAD
  const cosP = Math.cos(p)
  return [
    cosP * Math.sin(l),
    -(Math.cos(phi) * Math.sin(p) - Math.sin(phi) * cosP * Math.cos(l)),
    Math.sin(phi) * Math.sin(p) + Math.cos(phi) * cosP * Math.cos(l),
  ]
}

const f = (n: number) => n.toFixed(4)

/**
 * One ring as an SVG path in the unit circle, cut at the horizon.
 *
 * Every edge is clipped against the plane z = 0: one that leaves the near side
 * is cut where it crosses, and so is one that returns, so the ring falls into
 * runs that each start at an entry and end at an exit. The runs are then
 * joined along the rim: from each exit, walk the rim the way the ring is
 * wound to the nearest entry and continue with its run, until the walk is
 * back where it started; a ring that dips behind the horizon more than once
 * gives several closed pieces. Joining an exit to the next entry in ring order
 * instead, as a straight clip edge would allow, can send an arc the long way
 * round and enclose the whole disk. The arc is drawn along the unit circle
 * rather than as a chord through the globe. Around the rim the crossings of a
 * simple curve alternate, exit then entry; when they do not, which a country
 * seen edge on can manage through the rounding of its vertices and of the
 * crossings, every pairing is a guess, so each run is closed with a chord
 * instead. Those runs are slivers at the rim and the chord is a hair off.
 *
 * The winding is read from the whole ring in lon/lat (the committed rings do
 * not jump at the antimeridian, so that is a plain polygon) rather than from
 * the clipped shape, which for a sliver along the rim has no reliable sign of
 * its own. The projection keeps orientation on the near side, so
 * counter-clockwise in lon/lat is counter-clockwise on screen. A crossing is
 * the linear interpolation of the two unit vectors at z = 0, normalised:
 * within a pixel of the great circle at the data's spacing. Nothing on the
 * near side gives ''.
 */
export function ringPath(ring: Ring, rotation: Rotation): string {
  const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
  const pts = (closed ? ring.slice(0, -1) : ring).map(([lon, lat]) => toView(lon, lat, rotation))
  if (!pts.some((p) => p[2] >= 0)) return ''

  type Pt = { x: number; y: number; cut: 'exit' | 'entry' | null }
  const out: Pt[] = []
  const cut = (a: number[], b: number[], kind: 'exit' | 'entry') => {
    const t = a[2] / (a[2] - b[2])
    const x = a[0] + t * (b[0] - a[0])
    const y = a[1] + t * (b[1] - a[1])
    const n = Math.hypot(x, y) || 1
    out.push({ x: x / n, y: y / n, cut: kind })
  }
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const aIn = a[2] >= 0
    const bIn = b[2] >= 0
    if (aIn && bIn) out.push({ x: b[0], y: b[1], cut: null })
    else if (aIn) cut(a, b, 'exit')
    else if (bIn) {
      cut(a, b, 'entry')
      out.push({ x: b[0], y: b[1], cut: null })
    }
  }
  if (out.length === 0) return ''

  const line = (p: Pt) => `L${f(p.x)},${f(p.y)}`
  const first = out.findIndex((p) => p.cut === 'entry')
  if (first < 0) return `M${f(out[0].x)},${f(out[0].y)}${out.slice(1).map(line).join('')}Z`

  // The runs, each from an entry to an exit, in ring order from the first entry.
  const seq = [...out.slice(first), ...out.slice(0, first)]
  const runs: Pt[][] = []
  for (const p of seq) {
    if (p.cut === 'entry') runs.push([])
    runs[runs.length - 1].push(p)
  }

  let area = 0
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i]
    const [bx, by] = ring[(i + 1) % ring.length]
    area += ax * by - bx * ay
  }
  // East then north is counter-clockwise in lon/lat and on screen, which is
  // SVG's sweep flag 0. Screen angles grow clockwise, since y points down.
  const sweep = area > 0 ? 0 : 1
  const dir = sweep === 1 ? 1 : -1
  /** Position round the rim, growing the way the ring is wound. */
  const angle = (p: Pt) => (Math.atan2(p.y, p.x) * dir + 2 * Math.PI) % (2 * Math.PI)
  const along = (from: Pt, to: Pt) => (angle(to) - angle(from) + 2 * Math.PI) % (2 * Math.PI)
  const crossings = seq.filter((p) => p.cut).sort((a, b) => angle(a) - angle(b))
  const alternate = crossings.every((p, i) => p.cut !== crossings[(i + 1) % crossings.length].cut)
  if (!alternate) return runs.map((run) => `M${f(run[0].x)},${f(run[0].y)}${run.slice(1).map(line).join('')}Z`).join('')

  // From a run's exit, the run whose entry is nearest along the rim.
  const next = (run: Pt[]) => {
    const exit = run[run.length - 1]
    let best = 0
    let bestAlong = Infinity
    runs.forEach((r, i) => {
      const a = along(exit, r[0])
      if (a < bestAlong) {
        best = i
        bestAlong = a
      }
    })
    return { best, large: bestAlong > Math.PI ? 1 : 0 }
  }

  const done = new Set<number>()
  let d = ''
  for (let start = 0; start < runs.length; start++) {
    if (done.has(start)) continue
    let i = start
    d += `M${f(runs[i][0].x)},${f(runs[i][0].y)}`
    for (;;) {
      done.add(i)
      d += runs[i].slice(1).map(line).join('')
      const { best, large } = next(runs[i])
      const to = runs[best][0]
      d += `A1 1 0 ${large} ${sweep} ${f(to.x)},${f(to.y)}`
      if (best === start || done.has(best)) break
      i = best
    }
    d += 'Z'
  }
  return d
}

/**
 * The land as one SVG path, every ring filled, in the unit circle (globe) or
 * the flat map's 2 by 1 box. Drawn with the even-odd rule so a lake or an
 * enclave is a hole whichever way its ring runs. Flat rings are shifted by
 * `lambda` without wrapping, so the caller draws them at `lambda: 0`, pans
 * with a transform and covers the seam with a copy either side.
 */
export function landPath(rings: Ring[], rotation: Rotation, mode: 'globe' | 'flat'): string {
  let d = ''
  for (const ring of rings) {
    if (mode === 'globe') {
      d += ringPath(ring, rotation)
      continue
    }
    // Not through flat(): a ring that continues past 180 must not wrap back.
    ring.forEach(([lon, lat], i) => {
      d += `${i === 0 ? 'M' : 'L'}${f((lon + rotation.lambda) / 180)},${f(-lat / 180)}`
    })
    d += 'Z'
  }
  return d
}

/** Degrees between grid lines. Ten would be a mesh, thirty is a globe. */
const STEP = 30

/** How finely a line is sampled. Small enough that a curve reads as a curve. */
const SAMPLE = 5

/**
 * The lat/lon grid, as SVG paths in the unit circle.
 *
 * A line that passes behind the sphere is broken rather than joined: connecting
 * the point where it disappears to the point where it returns would draw a
 * chord straight through the middle of the globe, which is the one artefact
 * that makes a wireframe look wrong rather than sparse.
 */
export function graticule(rotation: Rotation): string[] {
  const paths: string[] = []

  const trace = (points: [number, number][]) => {
    let d = ''
    let drawing = false

    for (const [lon, lat] of points) {
      if (!visible(lon, lat, rotation)) {
        drawing = false
        continue
      }
      const { x, y } = project(lon, lat, rotation)
      d += `${drawing ? 'L' : 'M'}${x.toFixed(4)},${y.toFixed(4)}`
      drawing = true
    }

    if (d.length > 0) paths.push(d)
  }

  // Meridians, pole to pole.
  for (let lon = -180; lon < 180; lon += STEP) {
    const points: [number, number][] = []
    for (let lat = -90; lat <= 90; lat += SAMPLE) points.push([lon, lat])
    trace(points)
  }

  // Parallels, all the way round.
  for (let lat = -60; lat <= 60; lat += STEP) {
    const points: [number, number][] = []
    for (let lon = -180; lon <= 180; lon += SAMPLE) points.push([lon, lat])
    trace(points)
  }

  return paths
}

/**
 * Cents per point, the one calculation SPEC asks this module for.
 *
 * Both prices come from the owner. SPEC is explicit that loyalty sites are not
 * scraped, so nothing here guesses what a point is worth: it divides what you
 * would have paid by what it would cost you, and the answer is only as good as
 * the two numbers put in.
 */
export function centsPerPoint(cashCents: number, points: number, feesCents = 0): number | null {
  if (points <= 0) return null
  return (cashCents - feesCents) / points
}

/** The globe's radius in viewBox units. The flat map is 2R wide by R tall. */
export const R = 100
export const ZOOM_MIN = 1
export const ZOOM_MAX = 8

/** How far in the drawing is and where it has been pushed: screen = t + zoom * world. */
export type View = { zoom: number; tx: number; ty: number }

/** Half the width and height of what the svg shows, in viewBox units. */
export type Half = { x: number; y: number }

/**
 * Zoom about a point given in viewBox units, so whatever is under the cursor
 * (or between two fingers) stays there rather than sliding toward the centre.
 */
export function zoomAt(view: View, factor: number, px: number, py: number, mode: 'globe' | 'flat', half: Half): View {
  const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, view.zoom * factor))
  const k = zoom / view.zoom
  return clampView({ zoom, tx: px - k * (px - view.tx), ty: py - k * (py - view.ty) }, mode, half)
}

/**
 * Keeps the drawing over the box: an edge of it may be pushed no further than
 * the box's own edge, so nothing blank is dragged into view. `half` is what
 * the svg shows, which on a tall phone is more than the flat map's own
 * height, since the viewBox is letterboxed rather than stretched.
 */
export function clampView(view: View, mode: 'globe' | 'flat', half: Half): View {
  const limitX = Math.max(0, (mode === 'globe' ? R : 2 * R) * view.zoom - half.x)
  const limitY = Math.max(0, R * view.zoom - half.y)
  return {
    zoom: view.zoom,
    tx: Math.max(-limitX, Math.min(limitX, view.tx)),
    ty: Math.max(-limitY, Math.min(limitY, view.ty)),
  }
}
