import type { NavItem } from './nav'

// The phone tab bar's list. Its own file, with no imports beyond a type,
// because the tab bar is a client component and core/nav.ts reads the database.

/** The last phone tab: the page that lists everything the bar has no room for. */
export const BROWSE: NavItem = { href: '/browse', label: 'Browse', group: 'utilities' }

/**
 * The four the phone gets by name, then Browse. Filtered against the nav
 * rather than hardcoded into it, so a module the owner has disabled (or one
 * not built yet: Calendar arrives in v1.2 Phase 6a) drops out. No top-up
 * from the rest of the rail: the capsule holds these and Browse, nothing else.
 */
const PHONE_TABS = ['/', '/tasks', '/finance', '/calendar']

/** Every tab root, Browse included: the screens that draw no back control. */
export const PHONE_TAB_HREFS = [...PHONE_TABS, BROWSE.href]

export function phoneTabs(nav: NavItem[]): NavItem[] {
  return PHONE_TABS.map((href) => nav.find((n) => n.href === href))
    .filter((n): n is NavItem => n !== undefined)
    .concat(BROWSE)
}
