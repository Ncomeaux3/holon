'use client'

import Link from 'next/link'
import { Chevron } from '@/components/pos/Card'
import { NAV_ICON } from '@/components/pos/Sidebar'
import { Eyebrow } from '@/components/pos/text'
import { NAV_GROUPS, type NavItem } from '@/core/nav-groups'

function Row({ item, badge }: { item: NavItem; badge?: number }) {
  const Icon = NAV_ICON[item.href]
  return (
    // The inset hairline, from the label (16 + 24 + 14px in) to the trailing
    // edge: Row's separator, moved in to the label.
    <li className="relative before:absolute before:left-[54px] before:right-0 before:top-0 before:h-px before:bg-separator first:before:hidden">
      <Link
        href={item.href}
        className="flex min-h-11 items-center gap-3.5 px-4 py-2 text-body text-label outline-none hover:bg-fill-4 active:bg-fill-3 focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)"
      >
        <span className="grid size-6 shrink-0 place-items-center text-accent">
          {Icon && <Icon size={19} strokeWidth={1.8} aria-hidden />}
        </span>
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {badge !== undefined && badge > 0 && (
          <span className="num grid h-5 min-w-5 place-items-center rounded-capsule bg-accent px-1.5 text-caption-2 font-semibold text-accent-fg">
            {badge}
          </span>
        )}
        <Chevron />
      </Link>
    </li>
  )
}

/**
 * The same groups as the rail, one grouped list per heading. Client only for
 * the icon table, which lives in the sidebar's client file.
 */
export function Browse({ items, reviewCount }: { items: NavItem[]; reviewCount: number }) {
  return (
    <div className="space-y-6">
      {NAV_GROUPS.map((g) => {
        const rows = items.filter((item) => item.group === g.id)
        if (rows.length === 0) return null
        return (
          <section key={g.id}>
            {g.label && (
              <h2 className="mb-2">
                <Eyebrow>{g.label}</Eyebrow>
              </h2>
            )}
            <ul className="overflow-hidden rounded-card bg-grouped-2">
              {rows.map((item) => (
                <Row key={item.href} item={item} badge={item.href === '/review' ? reviewCount : undefined} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
