'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { ActionButton, Chip, Eyebrow, StatusChip, useToast } from '@/components/pos'
import { HIT } from '@/components/pos/button-classes'
import { syncFitness } from './sync'

/**
 * "Connect a workout source": what the page is when nothing is on file.
 *
 * Apple Health first: Health Auto Export posts workouts and readings, and is
 * the source. Strava second, because its API needs a paid Strava subscription.
 */
export function SetupCard({
  connected,
  detail,
}: {
  connected: boolean
  /** What Settings › Connections found when it last tested the token. */
  detail: string | null
}) {
  const [pending, start] = useTransition()
  const toast = useToast()

  const run = () =>
    start(async () => {
      const result = await syncFitness()
      toast(
        result.failed.length > 0 ? 'The import failed. The Agent Log has the error.' : 'Imported.',
      )
    })

  return (
    <div className="grid-bg -mx-[18px] mt-0 flex flex-1 items-center justify-center px-7 py-10 md:-mx-7">
      <div className="w-full max-w-[560px] bg-grouped-2 p-9 rounded-card">
        <Eyebrow>Module not connected</Eyebrow>
        <h2 className="mt-3.5 text-title-1 font-semibold text-label">
          Connect a workout source
        </h2>
        <p className="mt-3 text-subheadline text-label">
          Fitness reads workouts and body metrics from Apple Health. Each workout links to a Health
          skill, and the coach starts proposing plan changes for your review.
        </p>

        <div className="mt-[26px] flex items-center gap-4 border border-separator px-[18px] py-4 rounded-card">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <span className="text-body text-label">Apple Health</span>
              <Chip className="px-2 py-[3px] text-caption-1">Webhook</Chip>
            </div>
            <p className="mt-[5px] text-footnote text-secondary-label">
              Health Auto Export Premium posts workouts and readings from the phone. Add the secret
              in Settings, then the two automations on the phone.
            </p>
          </div>
          <Link
            href="/settings/connections"
            className={`${HIT} shrink-0 whitespace-nowrap text-footnote text-accent`}
          >
            Set up <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>

        <div
          className={`mt-3 flex items-center gap-4 border px-[18px] py-4 ${connected ? 'border-green-text' : 'border-separator'} rounded-card`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <span className="text-body text-label">Strava</span>
              <Chip className="px-2 py-[3px] text-caption-1">OAuth2</Chip>
              <StatusChip tone="neutral">Optional</StatusChip>
            </div>
            <p className="mt-[5px] text-footnote text-secondary-label">
              Needs a Strava subscription for API access. Workouts, duration, distance, heart rate. Scope{' '}
              <span className="num">activity:read_all</span>,{' '}
              <span className="num">profile:read_all</span>.
            </p>
            {connected && (
              <p className="mt-2.5 flex items-center gap-1.5">
                <StatusChip tone="ok">Connected</StatusChip>
                {detail && <span className="num text-caption-1 text-secondary-label">{detail}</span>}
              </p>
            )}
          </div>
          {connected ? (
            <span
              aria-hidden="true"
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center border border-green-text text-footnote text-green-text rounded-full"
            >
              ✓
            </span>
          ) : (
            // A GET form to the OAuth start route, so the DS button is the
            // shared one rather than a link dressed as it.
            <form action="/api/integrations/strava/oauth/start" method="get">
              <ActionButton variant="solid" size="xl" type="submit" className="gap-2 whitespace-nowrap">
                Connect with Strava <span aria-hidden="true">&rarr;</span>
              </ActionButton>
            </form>
          )}
        </div>

        <div className="mt-[22px] flex flex-wrap items-center justify-between gap-3 border-t border-separator pt-4">
          <span className="min-w-0 flex-1 text-footnote text-secondary-label">
            Credentials are encrypted at rest. Manage later in{' '}
            <Link href="/settings/connections" className={`${HIT} inline-block text-label hover:text-accent`}>
              Settings › Connections
            </Link>
            .
          </span>
          {connected && (
            <ActionButton
              variant="solid"
              size="xl"
              className="gap-2 whitespace-nowrap"
              onClick={run}
              disabled={pending}
            >
              <span className={pending ? 'animate-pulse' : undefined}>
                {pending ? 'Importing' : 'Run first import'}
              </span>
              {!pending && <span aria-hidden="true">&rarr;</span>}
            </ActionButton>
          )}
        </div>
      </div>
    </div>
  )
}
