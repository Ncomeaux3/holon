import Link from 'next/link'
import { LEGAL_DOCS } from '@/core/legal'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { ActionButton, Card, Eyebrow, fieldClass, MetricStrip, MetricTile } from '@/components/pos'
import { requireOwner } from '@/core/auth'
import { db } from '@/core/db'
import { getConnectionStatuses, getIntegrations } from '@/core/integrations'
import { getSettings, setSetting } from '@/core/settings'
import { clockIn, zoneAbbrIn } from '@/core/today'
import { cn } from '@/lib/utils'
import { SettingsHeader } from './tabs'
import { CapSlider } from './CapSlider'
import { Passkeys } from './Passkeys'
import { Session } from './Session'

async function save(formData: FormData) {
  'use server'
  // Server actions are standalone POST endpoints addressed by id. The (app)
  // layout does not run for them, so each one authenticates independently.
  await requireOwner()

  const hour = Number(formData.get('digest_hour'))
  const capDollars = Number(formData.get('llm_soft_cap_dollars'))

  await setSetting('timezone', String(formData.get('timezone') ?? '').trim())
  await setSetting('owner_name', String(formData.get('owner_name') ?? '').trim())
  // Clamp rather than trust the browser: these land in jobs and money maths.
  await setSetting('digest_hour', Math.min(23, Math.max(0, Math.round(hour || 0))))
  await setSetting('llm_soft_cap_cents', Math.max(0, Math.round(capDollars * 100)))

  revalidatePath('/settings')
  redirect('/settings?saved=1')
}

/** Month to date model spend, which is what the soft cap is measured against. */
async function spendThisMonthCents(): Promise<number> {
  const { rows } = await db().query<{ cents: string }>(
    `select coalesce(sum(cost_cents), 0)::text as cents
       from core.llm_calls
      where occurred_at >= date_trunc('month', now())`,
  )
  return Number(rows[0].cents)
}

// The last nightly run, the same row the Agent Log describes, so the two
// screens cannot disagree. Aggregating core.jobs instead read any job's
// last_run as the nightly's and any stale failed row as its status.
async function nightlyJobState() {
  const { rows } = await db().query<{ last_run: Date | null; last_status: string | null; n: string }>(
    `select r.started_at as last_run, r.status as last_status,
            (select count(*)::text from core.jobs) as n
       from core.job_runs r
      where r.finished_at is not null
      order by r.started_at desc
      limit 1`,
  )
  return rows[0] ?? { last_run: null, last_status: null, n: '0' }
}

// The read-only facts a bug report needs. The round trip is one `select 1`
// timed on its own, so it is the pooler and the network, not a query plan.
async function diagnostics() {
  const started = performance.now()
  await db().query('select 1')
  const roundTripMs = Math.round(performance.now() - started)
  // A row in core.connections is a stored key, whether or not its last test
  // passed; the Connections tab is where pass and fail are told apart.
  const statuses = await getConnectionStatuses()
  const providers = getIntegrations()
  const connected = providers.filter((m) => statuses[m.id]).map((m) => m.label)
  return { roundTripMs, connected, providerCount: providers.length }
}

const ZONES = [
  'America/Chicago',
  'America/New_York',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Australia/Sydney',
  'UTC',
]

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const field = fieldClass

export default async function SettingsPage({ searchParams }: PageProps<'/settings'>) {
  const [params, settings, spendCents, job, diag] = await Promise.all([
    searchParams,
    getSettings(),
    spendThisMonthCents(),
    nightlyJobState(),
    diagnostics(),
  ])

  const capCents = settings.llm_soft_cap_cents
  const zones = ZONES.includes(settings.timezone) ? ZONES : [settings.timezone, ...ZONES]
  // 09:00 UTC, printed on the owner's clock: "04:00 CDT".
  const cronAt = new Date()
  cronAt.setUTCHours(9, 0, 0, 0)
  const local = `${clockIn(cronAt, settings.timezone)} ${zoneAbbrIn(settings.timezone, cronAt)}`
  const lastRun = job.last_run ? clockIn(new Date(job.last_run), settings.timezone) : null

  return (
    <div className="space-y-[18px]">
      <SettingsHeader current="/settings" />

      <form action={save} className="flex max-w-[720px] flex-col gap-3.5">
        <Card>
          <Eyebrow>Owner</Eyebrow>
          <div className="mt-3 grid gap-3.5 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-footnote text-secondary-label">Name</span>
              <input name="owner_name" defaultValue={settings.owner_name} className={field} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-footnote text-secondary-label">Owner email · the only login allowed</span>
              <input
                value={process.env.OWNER_EMAIL ?? ''}
                readOnly
                aria-label="Owner email"
                className={cn(field, 'num bg-fill-3 text-label/70')}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-footnote text-secondary-label">Timezone</span>
              <select name="timezone" defaultValue={settings.timezone} className={field}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-footnote text-secondary-label">Digest email hour · local</span>
              <select name="digest_hour" defaultValue={String(settings.digest_hour)} className={`${field} num`}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Card>

        <Card>
          <div className="flex items-baseline justify-between gap-3">
            <Eyebrow>Model spend · soft cap</Eyebrow>
            <span className="num text-footnote text-secondary-label">
              Month to date <span className="text-label">{money(spendCents)}</span>
            </span>
          </div>
          <CapSlider initialDollars={Math.round(capCents / 100)} spendCents={spendCents} />
          <p className="mt-2.5 text-footnote text-secondary-label">
            Past the cap, research runs are refused and logged. Classification and headlines continue.
          </p>
        </Card>

        <Card>
          <Eyebrow>Nightly job</Eyebrow>
          <MetricStrip className="mt-3">
            <MetricTile label="Schedule" value={`0 9 * * * UTC · ${local}`} size="xs" />
            <MetricTile
              label="Last run"
              value={
                lastRun
                  ? `${job.last_status === 'clean' ? 'Ok' : cap(job.last_status ?? 'unknown')} · ${lastRun} · ${job.n} jobs`
                  : 'Never'
              }
              valueTone={
                !lastRun
                  ? undefined
                  : job.last_status === 'clean'
                    ? 'ok'
                    : job.last_status === 'partial'
                      ? 'warn'
                      : 'bad'
              }
              size="xs"
            />
            <MetricTile label="Jobs registered" value={`${job.n} · every module plus core`} size="xs" />
          </MetricStrip>
        </Card>

        <div className="flex items-center justify-end gap-2.5">
          {params.saved === '1' && <span className="num text-footnote text-secondary-label">Saved · core.settings</span>}
          <ActionButton type="submit" variant="solid">
            Save <span aria-hidden="true">&rarr;</span>
          </ActionButton>
        </div>
      </form>

      {/* Outside the form on purpose. Adding and removing a passkey happen the
        * moment they are clicked, against Supabase Auth rather than
        * core.settings, so they have nothing to do with Save. */}
      <Passkeys />

      {/* Read only: what to paste into a bug report. The last nightly run and
        * its outcome are in the Nightly job card above; the region is where the
        * round trip was measured from. */}
      <Card className="max-w-[720px]">
        <Eyebrow>Diagnostics</Eyebrow>
        <MetricStrip className="mt-3">
          <MetricTile label="Version" value={`v${process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown'}`} size="xs" />
          <MetricTile
            label="Database round trip"
            value={`${diag.roundTripMs} ms`}
            delta={`from ${process.env.VERCEL_REGION ?? 'local'}`}
            size="xs"
          />
          <MetricTile
            label="Connections with a key"
            value={`${diag.connected.length} of ${diag.providerCount}`}
            delta={diag.connected.length > 0 ? diag.connected.join(', ') : 'none saved'}
            size="xs"
          />
        </MetricStrip>
      </Card>

      <Session email={process.env.OWNER_EMAIL ?? ''} />

      <nav aria-label="Legal documents" className="flex max-w-[720px] flex-wrap gap-x-5">
        {LEGAL_DOCS.map((d) => (
          <Link key={d.href} href={d.href} className="inline-flex min-h-11 items-center text-footnote text-secondary-label underline-offset-4 hover:text-label hover:underline">
            {d.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
