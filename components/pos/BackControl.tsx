'use client'

import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PHONE_TAB_HREFS } from '@/core/phone-tabs'
import { goBack } from './PageTransition'

/**
 * The phone header's back control, drawn on every screen that is not a tab
 * root. An installed PWA has no browser chrome, so this and the edge drag are
 * the only ways back.
 *
 * A link to Browse that goes back in history instead when there is history to
 * go back to. A cold open on a deep link has nothing behind it, and a Back
 * that did nothing would read as broken.
 */
export function BackControl() {
  const pathname = usePathname()
  if (PHONE_TAB_HREFS.includes(pathname)) return null

  return (
    <Link
      href="/browse"
      transitionTypes={['back']}
      aria-label="Back"
      className="-ml-2.5 grid size-11 shrink-0 place-items-center rounded-control text-label transition-colors duration-150 hover:bg-accent/8 md:hidden"
      onClick={(e) => {
        if (window.history.length > 1) {
          e.preventDefault()
          goBack()
        }
      }}
    >
      <ChevronLeft size={22} strokeWidth={1.5} aria-hidden />
    </Link>
  )
}
