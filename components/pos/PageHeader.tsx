import { PageHeader as LargeTitle } from '@ncomeaux3/holon-ui'
import type { ComponentProps, ReactNode } from 'react'
import { AvatarMenu } from './AvatarMenu'
import { BackControl } from './BackControl'
import { BandSearch } from './BandSearch'

/**
 * holon-ui's large title header with POS's back control, band search and
 * avatar placed in it. The header renders a fragment, so its sticky bar sits
 * directly in the page column.
 */
export function PageHeader({
  search = true,
  searchPlaceholder,
  title,
  ...props
}: Omit<ComponentProps<typeof LargeTitle>, 'leading' | 'search' | 'trailing'> & {
  title: ReactNode
  /** False on the Search page, where the box below is the search. */
  search?: boolean
  /** Home's artboard asks a question; every other band says "Search <title>". */
  searchPlaceholder?: string
}) {
  return (
    <LargeTitle
      {...props}
      title={title}
      leading={<BackControl />}
      search={
        search && (
          <BandSearch
            placeholder={searchPlaceholder ?? (typeof title === 'string' ? `Search ${title.toLowerCase()}` : undefined)}
          />
        )
      }
      trailing={(phone) => <AvatarMenu phone={phone} className={phone ? '-mr-1.5' : undefined} />}
    />
  )
}
