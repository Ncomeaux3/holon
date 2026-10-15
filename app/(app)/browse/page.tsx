import { AvatarMenu } from '@/components/pos/AvatarMenu'
import { BandSearch } from '@/components/pos/BandSearch'
import { getNav, NAV_FOOTER } from '@/core/nav'
import { countPending } from '@/core/proposals'
import { Browse } from './Browse'

/**
 * The phone's last tab: where every module the bar has no room for lives.
 * Search on top, then the rail's groups: every enabled module and Review.
 * The utilities are behind the avatar, here as on every tab root. A static
 * segment, so it wins over `[module]`.
 */
export default async function BrowsePage() {
  const [nav, reviewCount] = await Promise.all([getNav(), countPending()])
  // Today is the first tab, Search is the band above the list and the
  // utilities are the avatar's.
  const items = [...nav, ...NAV_FOOTER].filter((n) => n.href !== '/' && n.group !== 'utilities')

  return (
    <div className="space-y-5">
      <BandSearch className="max-w-none" />
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-large-title font-bold text-label">Browse</h1>
        <AvatarMenu phone className="-mr-1.5" />
      </div>
      <Browse items={items} reviewCount={reviewCount} />
    </div>
  )
}
