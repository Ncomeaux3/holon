import { describe, expect, it } from 'vitest'
import { parseNumber } from './numbers'

describe('parseNumber', () => {
  it('reads a number the way it is shown on screen', () => {
    expect(parseNumber('$1,200.50')).toBe(1200.5)
    expect(parseNumber('1 200')).toBe(1200)
    expect(parseNumber('1200')).toBe(1200)
    expect(parseNumber('-5')).toBe(-5)
    expect(parseNumber('12.')).toBe(12)
  })

  it('is null when nothing numeric is left', () => {
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('abc')).toBeNull()
    expect(parseNumber('$')).toBeNull()
    expect(parseNumber('1.2.3')).toBeNull()
  })
})
