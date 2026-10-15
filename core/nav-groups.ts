// The nav's types and its group table, with no server import behind them,
// so the sidebar, Browse and the palette (client components) can read the
// groups without pulling the database into the browser bundle.

export type NavGroup = 'today' | 'plan' | 'knowledge' | 'life' | 'review' | 'utilities'

export type NavItem = {
  href: string
  label: string
  /** The heading the rail files it under. */
  group: NavGroup
}

/** The groups in rail order. A null label is a group with no heading. */
export const NAV_GROUPS: { id: NavGroup; label: string | null }[] = [
  { id: 'today', label: null },
  { id: 'plan', label: 'Plan' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'life', label: 'Life' },
  { id: 'review', label: null },
  { id: 'utilities', label: 'Utilities' },
]
