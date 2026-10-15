import { describe, expect, it } from 'vitest'
import { atTop, edgeBack, fromEdge, isLongPress, swipeOf } from './gestures'

describe('swipeOf', () => {
  it('needs to travel before it is a swipe', () => {
    // Anything shorter is a tap with a shaky thumb.
    expect(swipeOf(20, 0)).toBeNull()
    expect(swipeOf(-20, 0)).toBeNull()
    expect(swipeOf(80, 0)).toBe('right')
    expect(swipeOf(-80, 0)).toBe('left')
  })

  it('lets the dominant axis decide', () => {
    // A scroll is mostly vertical. Firing a horizontal swipe during one is how
    // a gesture gets removed rather than fixed.
    expect(swipeOf(70, 200)).toBeNull()
    expect(swipeOf(200, 70)).toBe('right')
  })

  it('ignores a downward pull unless the caller asked for one', () => {
    expect(swipeOf(0, 120)).toBeNull()
    expect(swipeOf(0, 120, { allowDown: true })).toBe('down')
    expect(swipeOf(0, 20, { allowDown: true })).toBeNull()
  })

  it('takes the threshold a caller gives it', () => {
    expect(swipeOf(30, 0, { minDistance: 20 })).toBe('right')
  })

  it('is null for a drag that went nowhere', () => {
    expect(swipeOf(0, 0)).toBeNull()
    expect(swipeOf(0, 0, { allowDown: true })).toBeNull()
  })
})

describe('atTop', () => {
  it('is only true at the very top', () => {
    // Anywhere else a downward drag is a scroll back up, and hijacking it makes
    // the page feel broken.
    expect(atTop(0)).toBe(true)
    expect(atTop(4)).toBe(true)
    expect(atTop(60)).toBe(false)
  })
})

describe('isLongPress', () => {
  it('needs the hold to last', () => {
    // Anything shorter is a tap that took a moment.
    expect(isLongPress(200, 0, 0)).toBe(false)
    expect(isLongPress(480, 0, 0)).toBe(true)
  })

  it('needs the finger to stay put', () => {
    // A finger that travelled is scrolling, however long it has been down.
    expect(isLongPress(600, 4, 6)).toBe(true)
    expect(isLongPress(600, 12, 0)).toBe(false)
    expect(isLongPress(600, 0, -12)).toBe(false)
  })
})

describe('fromEdge', () => {
  it('claims the first 20px for the edge', () => {
    expect(fromEdge(0)).toBe(true)
    expect(fromEdge(20)).toBe(true)
    expect(fromEdge(21)).toBe(false)
  })
})

describe('edgeBack', () => {
  it('fires past 90px from the edge, not from mid-screen', () => {
    expect(edgeBack(10, 120, 0)).toBe(true)
    expect(edgeBack(10, 60, 0)).toBe(false)
    // The same drag from the middle of the screen is a segment swipe.
    expect(edgeBack(180, 120, 0)).toBe(false)
    // A mostly vertical drag from the edge is a scroll.
    expect(edgeBack(10, 100, 300)).toBe(false)
  })
})
