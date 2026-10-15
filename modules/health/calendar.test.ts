import { describe, expect, it } from 'vitest'
import { appointmentItems, refillItems } from './calendar'

const range = { from: '2026-09-01', to: '2026-09-30' }

describe('appointmentItems', () => {
  const appointment = (over: Partial<Parameters<typeof appointmentItems>[0][number]> = {}) => ({
    id: 'a1',
    what: 'Annual physical',
    provider_name: null,
    status: 'confirmed',
    starts_local: '2026-09-10T09:00',
    ...over,
  })

  it('is timed, not all day', () => {
    const [item] = appointmentItems([appointment()], range)
    expect(item.allDay).toBe(false)
    expect(item.startsAt).toBe('2026-09-10T09:00')
  })

  it('adds the provider to the title when there is one', () => {
    const [item] = appointmentItems([appointment({ provider_name: 'Dr Lee' })], range)
    expect(item.title).toBe('Annual physical · Dr Lee')
  })

  it('excludes a cancelled appointment', () => {
    expect(appointmentItems([appointment({ status: 'cancelled' })], range)).toHaveLength(0)
  })

  it('drops one outside the range', () => {
    expect(appointmentItems([appointment({ starts_local: '2026-08-31T09:00' })], range)).toHaveLength(0)
  })
})

describe('refillItems', () => {
  const medication = (over: Partial<Parameters<typeof refillItems>[0][number]> = {}) => ({
    id: 'm1',
    name: 'Vitamin D',
    refill_on: '2026-09-15',
    ended_on: null,
    ...over,
  })

  it('titles it as a refill, all day', () => {
    const [item] = refillItems([medication()], range)
    expect(item.title).toBe('Refill Vitamin D')
    expect(item.allDay).toBe(true)
    expect(item.kind).toBe('refill')
  })

  it('excludes a medication ended before its refill date', () => {
    expect(
      refillItems([medication({ ended_on: '2026-09-01' })], range),
    ).toHaveLength(0)
  })

  it('keeps a medication that ends on or after the refill date', () => {
    expect(refillItems([medication({ ended_on: '2026-09-30' })], range)).toHaveLength(1)
  })
})
