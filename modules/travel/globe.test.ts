import { describe, expect, it } from 'vitest'
import { R, ZOOM_MAX, clampView, flat, graticule, landPath, project, ringPath, visible, zoomAt, type Ring, type Rotation } from './globe'

// An orthographic projection, hand rolled.
//
// The alternative was d3-geo plus topojson, which the plan budgeted for. The
// land is committed rings instead, filled and clipped at the horizon here, so
// the globe costs no dependency and nothing loads at runtime.

const NONE: Rotation = { lambda: 0, phi: 0 }

describe('project', () => {
  it('puts the point facing the viewer at the centre', () => {
    const p = project(0, 0, NONE)
    // Close to, not equal to: negating a zero gives -0, and Object.is
    // distinguishes the two even though nothing that draws a pixel does.
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.y).toBeCloseTo(0, 6)
  })

  it('puts the north pole at the top', () => {
    // Screen y grows downward, so the pole is negative.
    const p = project(0, 90, NONE)
    expect(p.x).toBeCloseTo(0, 6)
    expect(p.y).toBeCloseTo(-1, 6)
  })

  it('puts a quarter turn east on the right edge', () => {
    const p = project(90, 0, NONE)
    expect(p.x).toBeCloseTo(1, 6)
    expect(p.y).toBeCloseTo(0, 6)
  })

  it('keeps every visible point inside the unit circle', () => {
    for (let lon = -180; lon <= 180; lon += 17) {
      for (let lat = -90; lat <= 90; lat += 13) {
        const p = project(lon, lat, NONE)
        expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(1.0000001)
      }
    }
  })

  it('rotates, so spinning the globe moves what faces you', () => {
    // Rotate the globe 90 degrees and the point that was on the right edge is
    // now facing the viewer.
    const centred = project(90, 0, { lambda: -90, phi: 0 })
    expect(centred.x).toBeCloseTo(0, 6)
    expect(centred.y).toBeCloseTo(0, 6)
  })
})

describe('visible', () => {
  it('hides the far side of the globe', () => {
    // The antipode of the point facing you is behind the sphere.
    expect(visible(0, 0, NONE)).toBe(true)
    expect(visible(180, 0, NONE)).toBe(false)
    expect(visible(91, 0, NONE)).toBe(false)
  })

  it('counts the exact edge as visible rather than flickering there', () => {
    expect(visible(90, 0, NONE)).toBe(true)
  })

  it('follows the rotation', () => {
    expect(visible(180, 0, { lambda: -180, phi: 0 })).toBe(true)
    expect(visible(0, 0, { lambda: -180, phi: 0 })).toBe(false)
  })
})

describe('graticule', () => {
  it('draws meridians and parallels', () => {
    const lines = graticule(NONE)
    expect(lines.length).toBeGreaterThan(8)
    // Every path is a real polyline, not an empty string.
    expect(lines.every((d) => d.startsWith('M') && d.length > 10)).toBe(true)
  })

  it('breaks a line rather than drawing it across the sphere', () => {
    // The case that matters is a rotation putting the antimeridian in view: a
    // parallel is then visible at both ends of the sampled range and hidden in
    // the middle. Joining those two runs would draw a chord straight through
    // the globe, which is the one artefact that makes a wireframe look broken.
    //
    // Unrotated there is nothing to break: the visible hemisphere is a single
    // contiguous run of longitudes, so every line is one stroke.
    const seam = graticule({ lambda: -180, phi: 0 })
    expect(seam.some((d) => d.lastIndexOf('M') > 0)).toBe(true)
    expect(graticule(NONE).every((d) => d.lastIndexOf('M') === 0)).toBe(true)
  })
})

describe('flat and landPath', () => {
  it('flat puts the equator on the middle line and wraps the antimeridian', () => {
    expect(flat(0, 0, { lambda: 0, phi: 0 })).toEqual({ x: 0, y: -0 })
    expect(flat(90, 0, { lambda: 0, phi: 0 }).x).toBeCloseTo(0.5)
    expect(flat(170, 0, { lambda: 20, phi: 0 }).x).toBeCloseTo(-170 / 180)
    expect(flat(0, 45, { lambda: 0, phi: 0 }).y).toBeCloseTo(-0.25)
  })

  it('landPath fills every ring flat and only the near side on the globe', () => {
    const rings: Ring[] = [square(0, 0), square(180, 0)]
    const front = { lambda: 0, phi: 0 }
    expect(landPath(rings, front, 'globe').match(/Z/g)?.length).toBe(1)
    expect(landPath(rings, front, 'flat').match(/Z/g)?.length).toBe(2)
    expect(landPath(rings, front, 'flat')).not.toContain('A')
  })
})

/** A closed ten degree square about a point, counter-clockwise in lon/lat. */
function square(lon: number, lat: number): Ring {
  return [
    [lon - 5, lat - 5],
    [lon + 5, lat - 5],
    [lon + 5, lat + 5],
    [lon - 5, lat + 5],
    [lon - 5, lat - 5],
  ]
}

/** Every number in a path, so a point can be checked against the unit circle. */
function points(d: string): [number, number][] {
  const out: [number, number][] = []
  for (const m of d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)) out.push([Number(m[1]), Number(m[2])])
  for (const m of d.matchAll(/A1 1 0 [01] [01] (-?[\d.]+),(-?[\d.]+)/g)) out.push([Number(m[1]), Number(m[2])])
  return out
}

describe('ringPath', () => {
  it('draws a ring on the near side as straight edges and closes it', () => {
    const d = ringPath(square(0, 0), NONE)
    expect(d.startsWith('M')).toBe(true)
    expect(d.match(/L/g)?.length).toBe(3)
    expect(d.endsWith('Z')).toBe(true)
    expect(d).not.toContain('A')
  })

  it('draws nothing for a ring on the far side', () => {
    expect(ringPath(square(0, 0), { lambda: 180, phi: 0 })).toBe('')
  })

  it('cuts a ring that straddles the horizon and joins the cut with one arc along the rim', () => {
    const d = ringPath(square(90, 0), NONE)
    expect(d.match(/A/g)?.length).toBe(1)
    expect(d).not.toContain('NaN')
    expect(d.endsWith('Z')).toBe(true)
    const pts = points(d)
    expect(pts.length).toBeGreaterThan(3)
    for (const [x, y] of pts) expect(Math.hypot(x, y)).toBeLessThanOrEqual(1 + 1e-4)
    // The two crossings sit on the rim itself.
    const arc = d.match(/A1 1 0 [01] [01] (-?[\d.]+),(-?[\d.]+)/)!
    expect(Math.hypot(Number(arc[1]), Number(arc[2]))).toBeCloseTo(1, 3)
  })

  it('flips the arc sweep when the ring is wound the other way', () => {
    const sweep = (d: string) => d.match(/A1 1 0 [01] ([01])/)![1]
    const forward = ringPath(square(90, 0), NONE)
    const backward = ringPath([...square(90, 0)].reverse(), NONE)
    expect(sweep(forward)).not.toBe(sweep(backward))
  })

  it('joins a notch that dips behind the horizon with a short arc, not the long way round', () => {
    // The near-side square with a bite out of its horizon-facing edge, which
    // is Côte d'Ivoire seen from the US: two exits and two entries. Each exit
    // must join the nearest entry along the rim, or one arc circles the disk
    // and even-odd fills the sea.
    const notched: Ring = [
      [85, -5],
      [95, -5],
      [95, 5],
      [85, 5],
      [85, 2],
      [92, 1],
      [85, 0],
      [85, -5],
    ]
    const d = ringPath(notched, NONE)
    const arcs = [...d.matchAll(/A1 1 0 ([01]) [01]/g)].map((m) => m[1])
    expect(arcs).toEqual(['0', '0'])
    expect(d.match(/Z/g)?.length).toBe(2)
    for (const [x, y] of points(d)) expect(Math.hypot(x, y)).toBeLessThanOrEqual(1 + 1e-4)
  })

  it('closes with chords when the crossings do not alternate around the rim', () => {
    // A bow tie across the horizon: its crossings read exit, entry, entry,
    // exit around the rim, which no simple curve gives. A country seen edge
    // on can do the same through rounding, and a rim arc paired wrongly would
    // enclose the whole disk. Chords keep the error the size of the sliver.
    const bowTie: Ring = [
      [85, -5],
      [95, -5],
      [85, 5],
      [95, 8],
      [85, -5],
    ]
    const d = ringPath(bowTie, NONE)
    expect(d).not.toContain('A')
    expect(d).not.toContain('NaN')
    expect(d.match(/Z/g)?.length).toBe(2)
  })

  it('survives a run of vertices at the pole seen edge on', () => {
    const cap: Ring = [
      [-180, -90],
      [-90, -90],
      [0, -90],
      [90, -90],
      [180, -90],
      [180, -70],
      [90, -70],
      [0, -70],
      [-90, -70],
      [-180, -70],
      [-180, -90],
    ]
    const d = ringPath(cap, NONE)
    expect(d).not.toContain('NaN')
    expect(d.startsWith('M')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    for (const [x, y] of points(d)) expect(Math.hypot(x, y)).toBeLessThanOrEqual(1 + 1e-4)
  })
})

describe('zoomAt', () => {
  const home = { zoom: 1, tx: 0, ty: 0 }
  // The globe's box, R plus a 4 unit margin each way.
  const box = { x: R + 4, y: R + 4 }

  it('keeps the point under the cursor where it was', () => {
    const v = zoomAt(home, 2, 50, -20, 'globe', box)
    expect(v.zoom).toBe(2)
    // screen = t + zoom * world, and the cursor's world point was (50, -20).
    expect(v.tx + v.zoom * 50).toBeCloseTo(50)
    expect(v.ty + v.zoom * -20).toBeCloseTo(-20)
  })

  it('stays between 1x and 8x and sits home at 1x', () => {
    expect(zoomAt(home, 100, 30, 30, 'globe', box).zoom).toBe(ZOOM_MAX)
    expect(zoomAt({ zoom: 3, tx: -40, ty: 10 }, 0.01, 30, 30, 'globe', box)).toEqual(home)
  })

  it('never pans an edge of the drawing past the edge of the box', () => {
    // Zooming toward the corner would push the globe out of view: at 2x it
    // is 200 across and the box shows 104 each way, so 96 is as far as it goes.
    const v = zoomAt(home, 2, R + 4, R + 4, 'globe', box)
    expect(v.tx).toBe(-96)
    expect(v.ty).toBe(-96)
    // A phone shows the flat map letterboxed: the box is taller than the map,
    // so at 2x only the extra height may be dragged, and at 1x nothing.
    const phone = { x: 2 * R, y: 1.8 * R }
    expect(clampView({ zoom: 2, tx: -999, ty: -999 }, 'flat', phone)).toEqual({ zoom: 2, tx: -2 * R, ty: -20 })
    expect(clampView({ zoom: 1, tx: 0, ty: -50 }, 'flat', phone).ty).toBeCloseTo(0)
  })
})
