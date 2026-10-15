'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { syncClock } from '@/core/clock'
import { cn } from '@/lib/utils'
import { ActionButton } from './Button'
import { Eyebrow } from './text'
import { useToast } from './Toast'

/** What a sync action hands back; `detail` is toasted in place of "Synced." when present. */
export type SyncOutcome = { ran: number; failed: string[]; detail?: string }

/**
 * "SimpleFIN Bridge · synced 04:02" and a Sync now button, for a module
 * header's first band.
 *
 * What it says is a fact from core.jobs: the same row the nightly run writes,
 * so a module that has never pulled says so rather than showing a time that
 * came from somewhere else.
 */
export function SyncBand({
  provider,
  at,
  status,
  connected = true,
  hideProvider = false,
  arrivals,
  note,
  timeZone,
  onSync,
  also,
}: {
  /** The integration's label, or null when the module imports from nothing. */
  provider: string | null
  /** ISO timestamp of the last run, or null if it has never run. */
  at: string | null
  status: string | null
  /** False when the provider has no credentials. */
  connected?: boolean
  /** Leave the provider's line out: Fitness draws Strava only when it is connected. */
  hideProvider?: boolean
  /** What the phone last sent and what was refused, where a module takes inbound data. */
  arrivals?: { readings: string | null; workouts: string | null; rejected: number }
  /** What the last pull said, per account, where a module keeps that. Desktop only, like `arrivals`. */
  note?: string | null
  /** The owner's zone from core.settings: the clocks below are printed in it on the server and the device alike. */
  timeZone: string
  onSync: () => Promise<SyncOutcome>
  /** A second, wider pull beside the usual one: Finance's "Pull 90 days". */
  also?: { label: string; run: () => Promise<SyncOutcome> }
}) {
  const [pending, start] = useTransition()
  const toast = useToast()

  const sync = (run: () => Promise<SyncOutcome>) =>
    start(async () => {
      const result = await run()
      toast(
        result.failed.length > 0
          ? `${result.failed.join(', ')} failed. The Agent Log has the error.`
          : result.ran === 0
            ? 'Nothing to sync: this module imports from nothing.'
            : (result.detail ?? 'Synced.'),
      )
    })

  return (
    <>
      {/* The reading is desktop only: passed as a phoneAction, the band is
        * the button alone, which is all the phone's right slot has room for. */}
      {/* Inbound data has no job row to read, so it gets its own line, first:
        * Apple Health is where the workouts come from. From lg only: below it
        * the band has room for the warning or the clocks, not both, and the
        * warning is the one that needs acting on. */}
      {arrivals && (
        <span className="num hidden text-caption-1 text-secondary-label lg:inline">
          Apple Health · readings {arrivals.readings ? syncClock(arrivals.readings, timeZone) : 'never'}
          {' · '}
          workouts {arrivals.workouts ? syncClock(arrivals.workouts, timeZone) : 'never'}
        </span>
      )}
      {!hideProvider && (
        <Eyebrow
          className="hidden md:inline-flex"
          dot={!connected ? 'idle' : status === 'failed' ? 'bad' : at ? 'ok' : 'idle'}
        >
          {provider ?? 'Manual entry'}
          {' · '}
          {!connected
            ? 'not connected'
            : status === 'failed'
              ? 'last sync failed'
              : at
                ? `synced ${syncClock(at, timeZone)}`
                : 'never synced'}
        </Eyebrow>
      )}
      {/* Short on screen so the band stays one row; the advice rides in the
        * name and the tooltip. */}
      {arrivals && arrivals.rejected > 0 && (
        <Link
          href="/settings/connections"
          aria-label={`${arrivals.rejected} ${arrivals.rejected === 1 ? 'post' : 'posts'} rejected since then. Check the secret in both automations.`}
          title="Check the secret in both automations."
          className="num hidden min-h-(--target) items-center text-caption-1 text-orange-text underline-offset-2 hover:underline md:inline-flex"
        >
          {arrivals.rejected} {arrivals.rejected === 1 ? 'post' : 'posts'} rejected
        </Link>
      )}
      {note && (
        <span className="num hidden max-w-[360px] truncate text-caption-1 text-secondary-label md:inline" title={note}>
          {note}
        </span>
      )}
      {/* A quiet outline pill: syncing is a maintenance action, not the page's primary. */}
      <ActionButton variant="outline" size="md" onClick={() => sync(onSync)} disabled={pending}>
        <span className={cn(pending && 'animate-pulse')}>{pending ? 'Syncing' : 'Sync now'}</span>
      </ActionButton>
      {also && (
        <ActionButton variant="outline" size="md" onClick={() => sync(also.run)} disabled={pending}>
          {also.label}
        </ActionButton>
      )}
    </>
  )
}
