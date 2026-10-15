'use client'

import { Bell, ChevronRight, ScrollText, Settings, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, useContext, useState, type ReactNode } from 'react'
import { signOut } from '@/app/(app)/settings/session-actions'
import { PHONE_TAB_HREFS } from '@/core/phone-tabs'
import type { Theme } from '@/core/theme'
import { cn } from '@/lib/utils'
import { Avatar } from './Avatar'
import { ActionButton } from './Button'
import { Overlay } from './Overlay'
import { ThemeSwitch } from './ThemeSwitch'

/**
 * What the avatar shows and its menu needs, read once per request by the app
 * layout (a server component, so `owner_name` comes from `getSettings()`) and
 * handed down here. A context rather than props because PageHeader, which
 * places the avatar, is rendered by four client components and cannot read
 * settings itself.
 */
export type Shell = { initials: string; ownerName: string; unread: number; theme: Theme }

const ShellContext = createContext<Shell>({ initials: '?', ownerName: '', unread: 0, theme: 'system' })

export function ShellProvider({ value, children }: { value: Shell; children: ReactNode }) {
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
}

const ITEMS: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: '/settings', label: 'Settings', Icon: Settings },
  { href: '/notifications', label: 'Notifications', Icon: Bell },
  { href: '/agent-log', label: 'Agent log', Icon: ScrollText },
]

/**
 * The initials avatar and the utilities behind it: Settings, Notifications
 * with the unread count, the Agent log, the theme control and Sign out. On
 * the phone it sits top right of the tab roots only (a detail page has the
 * back control there instead); on the desktop it ends band one on every page.
 * The sheet on the phone and the drawer on the desktop are the one Overlay.
 */
export function AvatarMenu({ phone = false, className }: { phone?: boolean; className?: string }) {
  const { initials, ownerName, unread, theme } = useContext(ShellContext)
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  if (phone && !PHONE_TAB_HREFS.includes(pathname)) return null

  return (
    <>
      <button
        type="button"
        aria-label="Account"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-full transition-colors duration-150 hover:bg-fill-4',
          className,
        )}
      >
        <Avatar initials={initials} />
      </button>

      <Overlay open={open} onClose={() => setOpen(false)} narrow eyebrow="Account" title={ownerName || 'Account'}>
        <ul className="overflow-hidden rounded-card bg-grouped-2">
          {ITEMS.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                onClick={() => setOpen(false)}
                className="flex min-h-[52px] items-center gap-3.5 px-4 py-2.5 text-subheadline text-label hover:bg-fill-4"
              >
                <span className="grid size-6 shrink-0 place-items-center text-secondary-label">
                  <Icon size={19} strokeWidth={1.8} aria-hidden />
                </span>
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {href === '/notifications' && unread > 0 && (
                  <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-caption-1 text-accent-fg">
                    {unread}
                  </span>
                )}
                <ChevronRight size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-secondary-label" />
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-5 space-y-2">
          <div className="label text-caption-1 text-secondary-label">Theme</div>
          <ThemeSwitch theme={theme} />
        </div>

        {/* A plain form over the server action, as Settings has it: it works
          * before hydration and ends this browser's session only. */}
        <form action={signOut} className="mt-6">
          <ActionButton type="submit" variant="outline">
            Sign out
          </ActionButton>
        </form>
      </Overlay>
    </>
  )
}
