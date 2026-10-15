import { describe, expect, it } from 'vitest'
import { actualFor, kindFor, parseCategory, remaining } from './budget'

// The drawer's Budget tab: a line's actual is the confirmed itinerary of its
// kind unless the owner typed over it; the totals are what the cells show.
describe('budget lines', () => {
  const items = [
    { kind: 'flight', status: 'confirmed', amount_cents: 151000 },
    { kind: 'lodging', status: 'confirmed', amount_cents: 138000 },
    { kind: 'lodging', status: 'pending', amount_cents: 99900 },
    { kind: 'activity', status: 'confirmed', amount_cents: 18000 },
  ]

  it('maps a category name to an itinerary kind, loosely', () => {
    expect(kindFor('Flights')).toBe('flight')
    expect(kindFor('lodging')).toBe('lodging')
    expect(kindFor('Food & drink')).toBe('food')
    expect(kindFor('Activities')).toBe('activity')
    expect(kindFor('Gifts')).toBeNull()
  })

  it('sums confirmed items of the kind, or takes the override', () => {
    expect(actualFor({ category: 'Flights', actual_override_cents: null }, items)).toBe(151000)
    expect(actualFor({ category: 'Lodging', actual_override_cents: null }, items)).toBe(138000)
    expect(actualFor({ category: 'Gifts', actual_override_cents: null }, items)).toBe(0)
    expect(actualFor({ category: 'Gifts', actual_override_cents: 4200 }, items)).toBe(4200)
  })

  it('takes the larger of planned and spent off the budget, never their sum', () => {
    expect(remaining(480000, 289000, 120000)).toBe(191000)
    expect(remaining(480000, 289000, 310000)).toBe(170000)
    expect(remaining(100000, 0, 125000)).toBe(-25000)
  })

  it('parses "Gifts 200" into a category and dollars', () => {
    expect(parseCategory('Gifts 200')).toEqual({ category: 'Gifts', dollars: 200 })
    expect(parseCategory('Car hire')).toEqual({ category: 'Car hire', dollars: 0 })
    expect(parseCategory('   ')).toBeNull()
  })
})
