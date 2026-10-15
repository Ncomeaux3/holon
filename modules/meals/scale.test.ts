import { describe, expect, it } from 'vitest'
import { scaleQuantity, servingFactor } from './scale'

describe('scaleQuantity', () => {
  it('multiplies a plain quantity and keeps its unit', () => {
    expect(scaleQuantity('600 g', 2)).toEqual({ text: '1200 g', scaled: true })
    expect(scaleQuantity('250 g', 0.5)).toEqual({ text: '125 g', scaled: true })
    expect(scaleQuantity('1.5 L', 2)).toEqual({ text: '3 L', scaled: true })
  })

  it('moves only the first number', () => {
    // The 180 is the size of the fillet, not a count. Scaling both would turn
    // two fillets into four twice as large.
    expect(scaleQuantity('2 x 180 g', 2)).toEqual({ text: '4 x 180 g', scaled: true })
  })

  it('reads a simple fraction', () => {
    expect(scaleQuantity('1/2 cup', 2)).toEqual({ text: '1 cup', scaled: true })
    expect(scaleQuantity('1/2 cup', 3)).toEqual({ text: '1.5 cup', scaled: true })
  })

  it('leaves a quantity with no number exactly as written', () => {
    // Half a splash is not a measurement. Inventing one is worse than leaving
    // the cook to judge it.
    expect(scaleQuantity('a splash', 2)).toEqual({ text: 'a splash', scaled: false })
    expect(scaleQuantity('to taste', 0.5)).toEqual({ text: 'to taste', scaled: false })
    expect(scaleQuantity('', 2)).toEqual({ text: '', scaled: false })
  })

  it('rounds to something a kitchen can measure', () => {
    // 133.33333 g of oats is a precision no scale has, and 3.0 eggs reads as a
    // rounding error rather than three eggs.
    expect(scaleQuantity('80 g', 5 / 3).text).toBe('133.33 g')
    expect(scaleQuantity('1 banana', 3).text).toBe('3 banana')
  })

  it('refuses a factor that is not a multiplier', () => {
    expect(scaleQuantity('600 g', 0)).toEqual({ text: '600 g', scaled: false })
    expect(scaleQuantity('600 g', -2)).toEqual({ text: '600 g', scaled: false })
  })
})

describe('servingFactor', () => {
  it('is the ratio of what you want to what it makes', () => {
    expect(servingFactor(4, 2)).toBe(0.5)
    expect(servingFactor(1, 3)).toBe(3)
    expect(servingFactor(6, 6)).toBe(1)
  })

  it('falls back to one rather than dividing by nothing', () => {
    expect(servingFactor(0, 4)).toBe(1)
    expect(servingFactor(4, 0)).toBe(1)
  })
})
