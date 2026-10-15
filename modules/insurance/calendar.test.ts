import { describe, expect, it } from 'vitest'
import { toCalendarItems } from './calendar'

const range = { from: '2026-09-01', to: '2026-09-30' }

const row = (over: Partial<Parameters<typeof toCalendarItems>[0][number]> = {}) => ({
  id: 'p1',
  name: 'Renters',
  expires_on: '2026-09-15',
  status: 'active',
  ...over,
})

describe('toCalendarItems', () => {
  it('titles it as an expiry', () => {
    const [item] = toCalendarItems([row()], range)
    expect(item.title).toBe('Renters expires')
    expect(item.allDay).toBe(true)
    expect(item.kind).toBe('expiry')
  })

  it('excludes a lapsed or cancelled policy', () => {
    expect(toCalendarItems([row({ status: 'lapsed' })], range)).toHaveLength(0)
    expect(toCalendarItems([row({ status: 'cancelled' })], range)).toHaveLength(0)
  })

  it('drops a policy with no expiry or outside the range', () => {
    expect(toCalendarItems([row({ expires_on: null })], range)).toHaveLength(0)
    expect(toCalendarItems([row({ expires_on: '2026-10-01' })], range)).toHaveLength(0)
  })

  it('links to the policy', () => {
    const [item] = toCalendarItems([row()], range)
    expect(item.href).toBe('/insurance?policy=p1')
  })
})
