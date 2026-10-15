import { describe, expect, it } from 'vitest'
import { flyAt, labelScale, pinch, zoomStep, ZOOM_MAX, ZOOM_MIN, type View } from './view'

// The constellation's zoom is a group transform scale(z) translate(p). These
// pin the arithmetic the wheel handler applies per event, so a burst of
// trackpad deltas lands where the sum of the deltas says it should.

const start: View = { zoom: 1, pan: { x: 0, y: 0 } }

/** Where a viewBox point ends up on the group's own axes after the view. */
function project(v: View, x: number, y: number) {
  return { x: (x + v.pan.x) * v.zoom, y: (y + v.pan.y) * v.zoom }
}

describe('zoomStep', () => {
  it('is symmetric: in then out by the same delta returns to the start', () => {
    const at = { x: 120, y: -80 }
    const back = zoomStep(zoomStep(start, -40, 0, at), 40, 0, at)
    expect(back.zoom).toBeCloseTo(1, 12)
    expect(back.pan.x).toBeCloseTo(0, 9)
    expect(back.pan.y).toBeCloseTo(0, 9)
  })

  it('holds the point under the cursor still', () => {
    const at = { x: 200, y: 50 }
    const before = project(start, at.x, at.y)
    const after = project(zoomStep(start, -100, 0, at), at.x, at.y)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it('clamps at both ends and moves nothing when clamped', () => {
    const at = { x: 10, y: 10 }
    const top = zoomStep({ zoom: ZOOM_MAX, pan: { x: 3, y: 4 } }, -500, 0, at)
    expect(top).toEqual({ zoom: ZOOM_MAX, pan: { x: 3, y: 4 } })
    const bottom = zoomStep({ zoom: ZOOM_MIN, pan: { x: 3, y: 4 } }, 500, 0, at)
    expect(bottom).toEqual({ zoom: ZOOM_MIN, pan: { x: 3, y: 4 } })
  })

  it('composes: thirty small deltas equal one delta of their sum', () => {
    const at = { x: 0, y: 0 }
    let v = start
    for (let i = 0; i < 30; i++) v = zoomStep(v, -8, 0, at)
    expect(v.zoom).toBeCloseTo(zoomStep(start, -240, 0, at).zoom, 9)
  })

  it('doubles the zoom in about 230 pixels of scroll', () => {
    // 0.003 per pixel: exp(231 * 0.003) is 2. Half what it was, which felt
    // like scrolling for ever.
    expect(zoomStep(start, -231, 0, { x: 0, y: 0 }).zoom).toBeCloseTo(2, 2)
  })

  it('reads a wheel notch (deltaMode 1) as sixteen pixels', () => {
    const at = { x: 0, y: 0 }
    expect(zoomStep(start, -1, 1, at).zoom).toBeCloseTo(zoomStep(start, -16, 0, at).zoom, 12)
  })
})

describe('labelScale', () => {
  it('grows on screen by a third of the zoom, within the artboard clamp', () => {
    expect(labelScale(1)).toBe(1)
    expect(labelScale(2)).toBeCloseTo(Math.pow(0.5, 0.7), 9)
    expect(labelScale(0.1)).toBe(1.6)
    expect(labelScale(10)).toBe(0.6)
  })
})

describe('pinch', () => {
  const at = { x: 0, y: 0 }

  it('scales the zoom by how much the fingers spread', () => {
    expect(pinch(start, 100, 200, at).zoom).toBeCloseTo(start.zoom * 2, 9)
    expect(pinch(start, 200, 100, at).zoom).toBeCloseTo(start.zoom / 2, 9)
  })

  it('leaves the view alone when the fingers have not moved', () => {
    expect(pinch(start, 120, 120, at)).toEqual(start)
  })

  it('is the identity when the fingers are in the same place', () => {
    // Two pointers at one point have no distance between them to divide by.
    // Without this the zoom goes to Infinity and the tree disappears.
    expect(pinch(start, 0, 140, at)).toEqual(start)
    expect(pinch(start, -1, 140, at)).toEqual(start)
  })

  it('holds the midpoint still, so the tree grows where the fingers are', () => {
    const mid = { x: 120, y: -40 }
    const zoomed = pinch(start, 100, 200, mid)

    // The group is scale(z) translate(p), so a point p_v sits on screen at
    // z * (p_v + pan). The midpoint is the same place before and after.
    const screen = (v: View) => ({ x: v.zoom * (mid.x + v.pan.x), y: v.zoom * (mid.y + v.pan.y) })
    expect(screen(zoomed).x).toBeCloseTo(screen(start).x, 6)
    expect(screen(zoomed).y).toBeCloseTo(screen(start).y, 6)
  })

  it('clamps, so a fast pinch cannot leave the range the wheel keeps to', () => {
    expect(pinch(start, 1, 1000, at).zoom).toBe(ZOOM_MAX)
    expect(pinch(start, 1000, 1, at).zoom).toBe(ZOOM_MIN)
  })
})

describe('flyAt', () => {
  const to: View = { zoom: 2.4, pan: { x: -300, y: 90 } }

  it('starts at from and lands exactly on to', () => {
    expect(flyAt(start, to, 0)).toEqual(start)
    expect(flyAt(start, to, 1)).toEqual(to)
    expect(flyAt(start, to, 1.5)).toEqual(to)
  })

  it('eases out: more than half way at half time', () => {
    expect(flyAt(start, to, 0.5).zoom).toBeGreaterThan((start.zoom + to.zoom) / 2)
  })
})
