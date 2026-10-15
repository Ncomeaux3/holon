'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { HIT } from '@/components/pos/button-classes'
import { LEGAL_DOCS } from '@/core/legal'

// The three documents, the one being read marked. A client leaf only for the
// pathname; the pages themselves stay server rendered.

export function LegalNav() {
  const path = usePathname()
  return (
    <nav aria-label="Legal documents" className="mx-auto flex w-full max-w-[640px] flex-wrap gap-x-5 gap-y-2 px-4 sm:px-6">
      {LEGAL_DOCS.map((d) => (
        <Link
          key={d.href}
          href={d.href}
          aria-current={path === d.href ? 'page' : undefined}
          className={`${HIT} inline-block text-footnote text-secondary-label underline-offset-4 hover:text-label hover:underline aria-[current=page]:font-semibold aria-[current=page]:text-label`}
        >
          {d.label}
        </Link>
      ))}
    </nav>
  )
}
