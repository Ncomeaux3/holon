import { describe, expect, it } from 'vitest'
import type { NavItem } from './nav'
import { phoneTabs } from './phone-tabs'

const item = (href: string, label: string): NavItem => ({ href, label, group: 'life' })

const nav = [
  item('/', 'Today'),
  item('/finance', 'Finance'),
  item('/skills', 'Skill Tree'),
  item('/tasks', 'Tasks'),
  item('/goals', 'Goals'),
  item('/review', 'Review'),
]

describe('phoneTabs', () => {
  it('is Today, Tasks, Finance, Browse, whatever order the rail has', () => {
    expect(phoneTabs(nav).map((t) => t.label)).toEqual(['Today', 'Tasks', 'Finance', 'Browse'])
  })

  it('drops a disabled module without topping up and keeps Browse last', () => {
    // Finance disabled: the capsule holds three, not a module from the rail
    // in its place, and Browse stays last because it is where the rest of
    // the app is.
    const tabs = phoneTabs(nav.filter((n) => n.href !== '/finance'))
    expect(tabs.map((t) => t.href)).toEqual(['/', '/tasks', '/browse'])
  })

  it('adds Calendar once the module exists', () => {
    const tabs = phoneTabs([...nav, item('/calendar', 'Calendar')])
    expect(tabs.map((t) => t.href)).toEqual(['/', '/tasks', '/finance', '/calendar', '/browse'])
  })
})
