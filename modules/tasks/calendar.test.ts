import { describe, expect, it } from 'vitest'
import { toCalendarItems } from './calendar'

const range = { from: '2026-09-01', to: '2026-09-30' }
const today = '2026-08-31'

const row = (over: Partial<Parameters<typeof toCalendarItems>[0][number]> = {}) => ({
  id: 't1',
  title: 'Renew passport',
  due_on: '2026-09-15',
  due_at: null,
  status: 'open',
  repeat: null,
  ...over,
})

describe('toCalendarItems', () => {
  it('is all day when there is no time of day', () => {
    const [item] = toCalendarItems([row()], range, today)
    expect(item.allDay).toBe(true)
    expect(item.startsAt).toBe('2026-09-15')
  })

  it('combines the date and time when one is set', () => {
    const [item] = toCalendarItems([row({ due_at: '14:30' })], range, today)
    expect(item.allDay).toBe(false)
    expect(item.startsAt).toBe('2026-09-15T14:30')
  })

  it('marks a done task done rather than dropping it', () => {
    const [item] = toCalendarItems([row({ status: 'done' })], range, today)
    expect(item.done).toBe(true)
    expect(item.kind).toBe('task')
  })

  it('drops a due date outside the range', () => {
    expect(toCalendarItems([row({ due_on: '2026-08-31' })], range, today)).toHaveLength(0)
    expect(toCalendarItems([row({ due_on: '2026-10-01' })], range, today)).toHaveLength(0)
  })

  it('links to the task', () => {
    const [item] = toCalendarItems([row()], range, today)
    expect(item.href).toBe('/tasks?task=t1')
    expect(item.module).toBe('tasks')
  })

  it('projects an open repeating task through the range, muted and keyed by date', () => {
    const items = toCalendarItems([row({ due_on: '2026-08-20', repeat: { every: 'week' } })], range, today)
    expect(items.map((i) => i.startsAt)).toEqual(['2026-09-03', '2026-09-10', '2026-09-17', '2026-09-24'])
    expect(items.every((i) => i.projected)).toBe(true)
    expect(items[0].id).toBe('t1:2026-09-03')
    expect(items[0].href).toBe('/tasks?task=t1')
  })

  it('does not project from a done instance, which already wrote its successor', () => {
    const items = toCalendarItems([row({ status: 'done', repeat: { every: 'week' } })], range, today)
    expect(items).toHaveLength(1)
    expect(items[0].projected).toBeUndefined()
  })

  it('projects nothing on or before today, which completing would skip', () => {
    const items = toCalendarItems(
      [row({ due_on: '2026-08-20', repeat: { every: 'week' } })],
      range,
      '2026-09-17',
    )
    expect(items.map((i) => i.startsAt)).toEqual(['2026-09-24'])
  })
})
