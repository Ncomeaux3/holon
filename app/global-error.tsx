'use client'

import { useEffect } from 'react'
import { ActionButton } from '@/components/pos'
import { reportClientError } from './report-error'
import './globals.css'

// Replaces the root layout when the layout itself throws, so it renders its
// own html and body and imports globals.css directly; the root layout's
// markup never runs. No theme attribute: getTheme() is server only and there
// is no server to ask here.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  // Once per failure, so the Errors tab shows it without a trip to Vercel.
  useEffect(() => reportClientError(error), [error])

  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">
        <main className="flex min-h-dvh items-center justify-center p-6">
          <div className="max-w-sm space-y-3 text-center">
            <h1 className="text-title-2 font-semibold">Something broke</h1>
            <p className="text-footnote text-secondary-label">
              This page failed to render. When a digest is shown below, use it to find
              the matching error in the Vercel logs.
            </p>
            {error.digest && <p className="text-footnote text-secondary-label">Digest {error.digest}</p>}
            <ActionButton variant="outline" size="md" onClick={() => retry()}>
              Try again
            </ActionButton>
          </div>
        </main>
      </body>
    </html>
  )
}
