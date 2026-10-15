import { getModules } from './modules'
import { getSetting } from './settings'
import type { NavGroup, NavItem } from './nav-groups'

export { NAV_GROUPS, type NavGroup, type NavItem } from './nav-groups'

// One nav list, used by the sidebar, the phone tab bar, Browse and the
// palette, so none of them can disagree about what exists or where it sits.

/**
 * The rail's order and grouping, by module id: the label and the route still
 * come from the manifest. An enabled module that is not named here files
 * under Life after these, so nothing enabled is off the rail.
 */
const RAIL: [string, NavGroup][] = [
  ['tasks', 'plan'],
  ['calendar', 'plan'],
  ['goals', 'plan'],
  ['skills', 'plan'],
  ['brain', 'knowledge'],
  ['ideas', 'knowledge'],
  ['finance', 'life'],
  ['health', 'life'],
  ['fitness', 'life'],
  ['meals', 'life'],
  ['travel', 'life'],
  ['home', 'life'],
  ['insurance', 'life'],
]

async function enabledModules() {
  const enabled = await getSetting('modules_enabled')
  return getModules().filter((m) => enabled === null || enabled.includes(m.id))
}

/** Today, then every enabled module in rail order with its group, then Review. */
export async function getNav(): Promise<NavItem[]> {
  const modules = await enabledModules()
  const placed = RAIL.flatMap(([id, group]) =>
    modules.filter((m) => m.id === id).map((m) => ({ href: `/${m.id}`, label: m.nav.label, group })),
  )
  const rest = modules
    .filter((m) => !RAIL.some(([id]) => id === m.id))
    .map((m) => ({ href: `/${m.id}`, label: m.nav.label, group: 'life' as const }))

  return [
    { href: '/', label: 'Today', group: 'today' },
    ...placed,
    ...rest,
    { href: '/review', label: 'Review', group: 'review' },
  ]
}

/**
 * Enabled modules with no row named in RAIL. They are on the rail under Life
 * regardless; this is for callers that list the named rail apart from them.
 */
export async function getOffRailNav(): Promise<NavItem[]> {
  const modules = await enabledModules()
  return modules
    .filter((m) => !RAIL.some(([id]) => id === m.id))
    .map((m) => ({ href: `/${m.id}`, label: m.nav.label, group: 'life' as const }))
}

/** The sidebar footer. The phone reaches these through Browse and the palette. */
export const NAV_FOOTER: NavItem[] = [
  { href: '/search', label: 'Search', group: 'utilities' },
  { href: '/weekly-review', label: 'Weekly review', group: 'review' },
  { href: '/notifications', label: 'Notifications', group: 'utilities' },
  { href: '/agent-log', label: 'Agent log', group: 'utilities' },
  { href: '/settings', label: 'Settings', group: 'utilities' },
]
