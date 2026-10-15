'use client'

import { useRouter } from 'next/navigation'
import { TabBar, type Tab } from '@/components/pos'

/**
 * The DS tab row with the tab in the URL. TabBar is the button version because
 * it carries the artboard's 16px side padding; the route change is what keeps
 * `?tab=` linkable and alive across the reloads the screenshots take.
 */
export function ReviewTabs({
  tabs,
  value,
  className,
}: {
  tabs: Tab<string>[]
  value: string
  className?: string
}) {
  const router = useRouter()
  return (
    <TabBar
      label="Proposal status"
      tabs={tabs}
      value={value}
      onChange={(next) => router.push(`/review?tab=${next}`)}
      className={className}
      tabClassName="px-4"
    />
  )
}
