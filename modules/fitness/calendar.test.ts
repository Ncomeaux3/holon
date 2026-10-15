import { describe, expect, it } from 'vitest'
import { toCalendarItems } from './calendar'

const range = { from: '2026-09-01', to: '2026-09-30' }

const row = (over: Partial<Parameters<typeof toCalendarItems>[0][number]> = {}) => ({
  id: 'w1',
  name: 'Morning run',
  starts_local: '2026-09-10T06:30',
  ...over,
})

describe('toCalendarItems', () => {
  it('is timed and already done', () => {
    const [item] = toCalendarItems([row()], range)
    expect(item.allDay).toBe(false)
    expect(item.done).toBe(true)
    expect(item.startsAt).toBe('2026-09-10T06:30')
    expect(item.kind).toBe('workout')
  })

  it('drops a workout outside the range', () => {
    expect(toCalendarItems([row({ starts_local: '2026-10-01T06:30' })], range)).toHaveLength(0)
  })

  it('links to Fitness', () => {
    const [item] = toCalendarItems([row()], range)
    expect(item.href).toBe('/fitness')
  })
})
