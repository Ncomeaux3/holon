import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalendarItem } from '@/core/module-contract'

// The digest's own arithmetic: today and tomorrow counted apart, a module the
// owner switched off left out, and a done item never offered as next.

const items: CalendarItem[] = []
let hidden: string[] = []

vi.mock('@/core/today', () => ({ ownerToday: async () => '2026-09-23' }))
vi.mock('@/core/calendar-registry', () => ({ calendarItems: async () => items }))
vi.mock('../data', () => ({ getHidden: async () => hidden }))

const { nightlyDigest } = await import('./nightly-digest')

const item = (over: Partial<CalendarItem>): CalendarItem => ({
  id: 'x',
  module: 'tasks',
  title: 'x',
  startsAt: '2026-09-23',
  allDay: true,
  href: '/',
  kind: 'task',
  ...over,
})

beforeEach(() => {
  items.length = 0
  hidden = []
})

describe('calendar digest', () => {
  it('counts today and tomorrow apart', async () => {
    items.push(item({ id: 'a' }), item({ id: 'b', startsAt: '2026-09-23T09:00', allDay: false }), item({ id: 'c', startsAt: '2026-09-24' }))
    expect(await nightlyDigest()).toMatchObject({ today: 2, tomorrow: 1 })
  })

  it('leaves out a module the owner switched off', async () => {
    items.push(item({ id: 'a' }), item({ id: 'b', module: 'meals' }))
    hidden = ['meals']
    const digest = await nightlyDigest()
    expect(digest.today).toBe(1)
    expect(digest.next.map((n) => n.module)).toEqual(['tasks'])
  })

  it('never offers a done item as next', async () => {
    items.push(item({ id: 'a', title: 'Ran', done: true }), item({ id: 'b', title: 'Dentist' }))
    expect((await nightlyDigest()).next.map((n) => n.title)).toEqual(['Dentist'])
  })
})
