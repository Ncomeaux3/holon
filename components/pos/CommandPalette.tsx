'use client'

import { CommandPalette as Palette, type PaletteItem } from '@ncomeaux3/holon-ui'
import { paletteSearch } from '@/app/(app)/search/actions'
import type { NavItem } from '@/core/nav'

// Cmd K anywhere in the app: holon-ui's palette fed with POS's nav and search.
// BandSearch and QuickSearchButton open it through the `pos:search` event.

const hint = (n: NavItem) => (n.group === 'today' || n.group === 'review' ? n.label : n.group[0].toUpperCase() + n.group.slice(1))

// Hits share `/${module}` hrefs, so each keeps its entity id as the key.
const search = (q: string): Promise<PaletteItem[]> =>
  paletteSearch(q).then((rows) =>
    rows.map((h) => ({ key: h.id, label: h.title, hint: `${h.moduleLabel} · ${h.entityType}`, href: `/${h.module}` })),
  )

export function CommandPalette({ nav }: { nav: NavItem[] }) {
  return (
    <Palette
      items={nav.map((n) => ({ key: `nav-${n.href}`, label: n.label, hint: hint(n), href: n.href }))}
      search={search}
      searchAllHref={(q) => `/search?q=${encodeURIComponent(q)}`}
      openEvent="pos:search"
    />
  )
}
