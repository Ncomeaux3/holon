'use client'

import { useEffect } from 'react'
import { ActionButton } from '@/components/pos'
import { reportClientError } from './report-error'

// Wraps every page under the root layout. The digest is what Next logs
// server side in place of the message, so it is shown here so the owner can
// match the two.
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  // Once per failure, so the Errors tab shows it without a trip to Vercel.
  useEffect(() => reportClientError(error), [error])

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-sm space-y-3 text-center">
        <h1 className="text-title-2 font-semibold">Something broke</h1>
        <p className="text-footnote text-secondary-label">
          This page failed to render. When a digest is shown below, use it to find the
          matching error in the Vercel logs.
        </p>
        {error.digest && <p className="text-footnote text-secondary-label">Digest {error.digest}</p>}
        <ActionButton variant="outline" size="md" onClick={() => retry()}>
          Try again
        </ActionButton>
      </div>
    </main>
  )
}
