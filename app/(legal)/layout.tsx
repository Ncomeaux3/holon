import Link from 'next/link'
import type { ReactNode } from 'react'
import { HolonLockup } from '@/components/pos'
import { LegalNav } from './LegalNav'

// Public: proxy.ts lets /terms and /privacy through without a session, because
// Google's consent screen and anyone deciding whether to sign up must be able
// to read them first.


export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 shrink-0 items-center px-4 sm:px-7">
        <Link href="/login" aria-label="Holon, sign in" className="flex min-h-11 items-center">
          <HolonLockup size={32} />
        </Link>
      </header>
      <LegalNav />
      <main className="mx-auto w-full max-w-[640px] flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
