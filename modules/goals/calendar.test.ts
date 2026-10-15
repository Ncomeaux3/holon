import { describe, expect, it } from 'vitest'
import { toCalendarItems } from './calendar'

const range = { from: '2026-09-01', to: '2026-09-30' }

const row = (over: Partial<Parameters<typeof toCalendarItems>[0][number]> = {}) => ({
  id: 'g1',
  title: 'Run a 10k',
  deadline: '2026-09-20',
  ...over,
})

describe('toCalendarItems', () => {
  it('is an all day item on the deadline', () => {
    const [item] = toCalendarItems([row()], range)
    expect(item.allDay).toBe(true)
    expect(item.startsAt).toBe('2026-09-20')
    expect(item.kind).toBe('goal')
  })

  it('drops a deadline outside the range', () => {
    expect(toCalendarItems([row({ deadline: '2026-10-01' })], range)).toHaveLength(0)
  })

  it('links to the goals screen', () => {
    const [item] = toCalendarItems([row()], range)
    expect(item.href).toBe('/goals')
  })
})
