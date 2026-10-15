import Link from 'next/link'
import { HIT } from '@/components/pos/button-classes'

export default function NotOwnerPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-sm space-y-3 text-center">
        <h1 className="text-large-title font-bold text-label">Not your install</h1>
        <p className="text-subheadline text-secondary-label">
          This is a single user system and you are signed in as somebody else.
        </p>
        <Link href="/login" className={`${HIT} inline-block text-subheadline text-label underline underline-offset-4`}>
          Sign in as the owner
        </Link>
      </div>
    </main>
  )
}
