import { requireOwner } from '@/core/auth'
import { getNav, getOffRailNav, NAV_FOOTER } from '@/core/nav'
import { initials } from '@/core/initials'
import { countUnread } from '@/core/notify'
import { countPending } from '@/core/proposals'
import { getSettings } from '@/core/settings'
import { getSidebarCollapsed, getTheme } from '@/core/theme'
import { ShellProvider } from '@/components/pos/AvatarMenu'
import { CommandPalette } from '@/components/pos/CommandPalette'
import { MobileTabBar, Sidebar } from '@/components/pos/Sidebar'
import { ToastProvider } from '@/components/pos'
import { PageTransition } from '@/components/pos/PageTransition'
import { PullToRefresh } from '@/components/pos/PullToRefresh'
import { EdgeBack } from '@/components/pos/EdgeBack'

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  await requireOwner()

  const [nav, offRail, collapsed, theme, reviewCount, settings, unread] = await Promise.all([
    getNav(),
    getOffRailNav(),
    getSidebarCollapsed(),
    getTheme(),
    // The same count Browse and Review show: a snoozed proposal is not a badge.
    countPending(),
    // The avatar's initials and its menu's unread badge (PageHeader places
    // the avatar; this is where the request-scoped reads happen).
    getSettings(),
    countUnread(),
  ])

  return (
    <ToastProvider>
      <ShellProvider value={{ initials: initials(settings.owner_name), ownerName: settings.owner_name, unread, theme }}>
      <Sidebar nav={nav} footer={NAV_FOOTER} collapsed={collapsed} reviewCount={reviewCount} />
      <MobileTabBar nav={nav} reviewCount={reviewCount} />
      <CommandPalette nav={[...nav, ...NAV_FOOTER, ...offRail]} />
      <PullToRefresh />
      <EdgeBack />
      {/* The status bar is translucent in standalone mode (black-translucent
        * in app/layout.tsx), so scrolled rows would pass under the clock with
        * nothing behind them. This is the material iOS bars put there: the
        * height of the inset, zero in a browser tab, none on the desktop. */}
      <div
        aria-hidden
        className="glass-regular statusbar pointer-events-none fixed inset-x-0 top-0 z-40 h-[var(--inset-t)] rounded-none border-0 shadow-none md:hidden"
      />

      <main
        // The sidebar is fixed so the rail never scrolls with the page; this
        // keeps the column clear of it and clear of the mobile tab bar.
        // --rail lives on <html> (app/layout.tsx) so the collapse toggle can
        // move it without a server round trip.
        // 18px of side padding on a phone, not 28: the artboard's body runs
        // `14px 18px 22px`, and 28 on a 402px screen was costing 20px of a
        // column that was already truncating its own rows. The top clears
        // the status bar and Dynamic Island in standalone mode; a browser
        // tab reports a zero inset and gets the flat 18px.
        className="min-w-0 flex-1 md:[margin-left:var(--rail)]"
      >
        {/* The padding sits on the page, not on main, so the phone's push and
          * pop snapshot one opaque full-height column in the canvas colour
          * (components/pos/PageTransition.tsx). */}
        <PageTransition className="page reveal min-h-dvh px-[18px] pt-[max(18px,calc(var(--inset-t)+16px))] pb-[calc(var(--tabbar)+18px)] md:px-10 md:py-7">
          {children}
        </PageTransition>
      </main>
      </ShellProvider>
    </ToastProvider>
  )
}
