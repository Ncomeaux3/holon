'use client'

import {
  Dumbbell,
  HeartPulse,
  Bell,
  Brain,
  CalendarCheck,
  CalendarDays,
  Compass,
  House,
  Inbox,
  Lightbulb,
  LineChart,
  ListChecks,
  Network,
  Plane,
  ScrollText,
  Search,
  Settings,
  Shield,
  Sun,
  Target,
  Utensils,
  type LucideIcon,
} from 'lucide-react'
import { MobileTabBar as TabBarShell, Sidebar as SidebarShell, fadeClass, type NavIcon } from '@ncomeaux3/holon-ui'
import Link from 'next/link'
import { NAV_GROUPS, type NavItem } from '@/core/nav-groups'
import { phoneTabs } from '@/core/phone-tabs'
import { setSidebarCookie } from '@/core/theme-client'
import { HolonMark, HolonWordmark } from './Logo'

// The rail and the capsule are holon-ui's; POS supplies its routes, icons,
// the review count, the Holon mark and the cookie that remembers the width.

export function Sidebar({
  nav,
  footer,
  collapsed,
  reviewCount,
}: {
  nav: NavItem[]
  footer: NavItem[]
  collapsed: boolean
  reviewCount: number
}) {
  // Weekly review files under the Review heading with Review itself; the
  // utilities are behind the avatar in band one, not on the rail.
  const items = [...nav, ...footer.filter((f) => f.group === 'review')].map((item) => ({
    ...item,
    icon: NAV_ICON[item.href],
    badge: item.href === '/review' ? reviewCount : undefined,
  }))

  return (
    <SidebarShell
      items={items}
      groups={NAV_GROUPS.filter((g) => g.id !== 'utilities')}
      collapsed={collapsed}
      onCollapse={setSidebarCookie}
      brand={(c) => (
        // The ribbon at 36px with the wordmark; the owner's name is on Today.
        <Link href="/" aria-label="Today" className="flex min-w-0 items-center gap-3 text-label">
          <HolonMark size={36} />
          <HolonWordmark height={22} className={fadeClass(c)} />
        </Link>
      )}
    />
  )
}

/**
 * One icon per route, for the bottom tab bar.
 *
 * The phone artboard draws a glyph per tab, not the two digit code the rail
 * uses: at 78px of width a code and a label are two lines of small type and
 * the bar reads as a table. Keyed by href so a module without an entry falls
 * back to its code rather than to a wrong picture.
 */
export const NAV_ICON: Record<string, LucideIcon> = {
  '/': Sun,
  '/browse': Compass,
  '/finance': LineChart,
  '/tasks': ListChecks,
  '/calendar': CalendarDays,
  '/fitness': Dumbbell,
  '/brain': Brain,
  '/skills': Network,
  '/goals': Target,
  '/health': HeartPulse,
  '/home': House,
  '/ideas': Lightbulb,
  '/insurance': Shield,
  '/meals': Utensils,
  '/travel': Plane,
  '/review': Inbox,
  '/search': Search,
  '/weekly-review': CalendarCheck,
  '/notifications': Bell,
  '/agent-log': ScrollText,
  '/settings': Settings,
}

/** The Today tab draws the ribbon rather than an icon. */
const TodayMark: NavIcon = ({ size }) => <HolonMark size={size} />

/**
 * Below 768px: the capsule of tabs (Today, Tasks, Finance, Calendar, Browse).
 * Browse lists the rest of the app; the utilities are behind the avatar. The
 * review count rides the first tab, which is where a proposal lands.
 */
export function MobileTabBar({ nav, reviewCount }: { nav: NavItem[]; reviewCount: number }) {
  const tabs = phoneTabs(nav).map((item, i) => ({
    ...item,
    icon: item.href === '/' ? TodayMark : NAV_ICON[item.href],
    badge: i === 0 ? reviewCount : undefined,
  }))
  return <TabBarShell tabs={tabs} />
}
