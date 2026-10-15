import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { Eyebrow } from '@/components/pos'
import { BASE, SIZE, VARIANT } from '@/components/pos/button-classes'
import { getModule, missingConnections } from '@/core/modules'
import { cn } from '@/lib/utils'

/**
 * Every module page in the app is served from here. A module supplies pages in
 * its manifest and gets routes; it never adds a file under app/.
 *
 * Static segments like /settings win over this dynamic one, so core pages are
 * unaffected.
 */
export default async function ModulePage({ params }: PageProps<'/[module]/[[...path]]'>) {
  const { module: moduleId, path } = await params

  const manifest = getModule(moduleId)
  if (!manifest) notFound()

  const Page = manifest.pages[(path ?? []).join('/')]
  if (!Page) notFound()

  // A missing provider is a banner, not a wall.
  //
  // It used to replace the page entirely, on the reasoning that an unconnected
  // module has nothing to show. That is not true of any module here: Finance
  // works on accounts kept by hand, Fitness on workouts logged by hand, and
  // hiding a page that has real data in it because a sync is not set up is
  // worse than the empty tables it was avoiding. Every module page already
  // says what an empty section means, which is the better place for it.
  //
  // `requires` still earns its keep: Settings, Connections reads it to say
  // which modules a provider feeds.
  //
  // The banner streams in under Suspense so the page itself is not held
  // behind the connections query.
  return (
    <div className="space-y-5">
      <Suspense fallback={null}>
        <NotSyncing ids={manifest.requires ?? []} />
      </Suspense>

      <Page />
    </div>
  )
}

async function NotSyncing({ ids }: { ids: string[] }) {
  const missing = await missingConnections(ids)
  if (missing.length === 0) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card bg-grouped-2 px-4 py-3">
      <div className="min-w-0 space-y-1">
        <Eyebrow dot="warn">Not syncing</Eyebrow>
        <p className="text-footnote text-orange-text">
          {missing.join(', ')} {missing.length === 1 ? 'is' : 'are'} not connected, so nothing here
          updates on its own. Anything you enter by hand still works.
        </p>
      </div>
      <Link
        href="/settings/connections"
        className={cn(BASE, SIZE.md, VARIANT.normal)}
      >
        Connect
      </Link>
    </div>
  )
}
