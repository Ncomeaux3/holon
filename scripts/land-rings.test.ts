import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { pointInRings, type Ring } from './land-rings-lib'

// The committed rings are what the globe draws. The test pins their shape
// rather than regenerating them: regenerating needs the atlas.
describe('modules/travel/land.json', () => {
  const rings = JSON.parse(readFileSync('modules/travel/land.json', 'utf8')) as Ring[]

  it('is a few hundred closed rings inside the world, under 200 KB', () => {
    expect(rings.length).toBeGreaterThan(150)
    expect(readFileSync('modules/travel/land.json').byteLength).toBeLessThan(200_000)
    for (const ring of rings) {
      expect(ring.length).toBeGreaterThan(3)
      expect(ring[0]).toEqual(ring[ring.length - 1])
      for (const [lon, lat] of ring) {
        // A ring that crosses the antimeridian continues past 180 rather than jumping.
        expect(lon).toBeGreaterThanOrEqual(-360)
        expect(lon).toBeLessThanOrEqual(360)
        expect(lat).toBeGreaterThanOrEqual(-90)
        expect(lat).toBeLessThanOrEqual(90)
      }
    }
  })

  it('has land at Denver and Tokyo and none in the middle of the Pacific', () => {
    expect(pointInRings(39.7, -105, rings)).toBe(true)
    expect(pointInRings(35.7, 139.7, rings)).toBe(true)
    expect(pointInRings(0, -140, rings)).toBe(false)
  })
})

describe('pointInRings', () => {
  const square: Ring = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ]
  const hole: Ring = [
    [4, 4],
    [6, 4],
    [6, 6],
    [4, 6],
    [4, 4],
  ]
  it('is even-odd: inside the square, outside its lake', () => {
    expect(pointInRings(2, 2, [square, hole])).toBe(true)
    expect(pointInRings(5, 5, [square, hole])).toBe(false)
    expect(pointInRings(12, 5, [square, hole])).toBe(false)
  })
})
