import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import {
  ActionButton,
  Card,
  Chip,
  ConfirmButton,
  Eyebrow,
  fieldClass,
  MetricStrip,
  MetricTile,
  Row,
  RowList,
  StatusChip,
} from '@/components/pos'
import { BASE, SIZE, VARIANT } from '@/components/pos/button-classes'
import { requireOwner } from '@/core/auth'
import { cn } from '@/lib/utils'
import { db } from '@/core/db'
import {
  type ConnectionStatus,
  type IntegrationManifest,
  deleteCredentials,
  getConnectionStatuses,
  freshCredentials,
  getCredentials,
  getIntegration,
  getIntegrations,
  saveCredentials,
} from '@/core/integrations'
import { getModules } from '@/core/modules'
import { getOrigin } from '@/core/origin'
import { getSetting } from '@/core/settings'
import { clockIn } from '@/core/today'
import { Copy } from '@/components/pos'
import { SettingsHeader } from '../tabs'
import { Reveal } from './Reveal'

// One card per manifest. Adding a provider folder adds a card; nothing here
// knows any provider by name.

async function save(formData: FormData) {
  'use server'
  // Server actions are standalone POST endpoints addressed by id. The (app)
  // layout does not run for them, so each one authenticates independently.
  await requireOwner()
  const id = String(formData.get('id'))
  const manifest = getIntegration(id)
  if (!manifest || manifest.auth.type !== 'token') return

  const existing = (await getCredentials(id)) ?? {}
  const creds: Record<string, string> = { ...existing }
  for (const field of manifest.auth.fields) {
    const value = String(formData.get(field.key) ?? '').trim()
    // A blank secret means "leave the stored one alone", so re-saving a
    // repository name does not wipe the token next to it.
    if (value || !field.secret) creds[field.key] = value
  }

  // Before test, and only on save: a one-shot credential has to be exchanged
  // and the exchanged value is what gets stored. Test never runs this, because
  // pressing Test twice must not consume anything.
  let prepared = creds
  if (manifest.prepare) {
    try {
      prepared = await manifest.prepare(creds)
    } catch (error) {
      await saveCredentials(id, creds, {
        status: 'error',
        testDetail: error instanceof Error ? error.message : 'Could not prepare the credential.',
      })
      revalidatePath('/settings/connections')
      return
    }
  }

  const result = await manifest.test(prepared)
  await saveCredentials(id, prepared, {
    status: result.ok ? 'connected' : 'error',
    testDetail: result.detail,
  })
  revalidatePath('/settings/connections')
}

async function test(formData: FormData) {
  'use server'
  await requireOwner()
  const id = String(formData.get('id'))
  const manifest = getIntegration(id)
  // Refreshed first, so an OAuth token that lapsed an hour ago tests as what
  // the nightly pull will see rather than as broken.
  // A refresh the provider refuses is a failed test, not a crashed action.
  let creds: Awaited<ReturnType<typeof freshCredentials>>
  try {
    creds = await freshCredentials(id, manifest?.refresh)
  } catch (error) {
    const stored = await getCredentials(id)
    if (stored) {
      await saveCredentials(id, stored, {
        status: 'error',
        testDetail: error instanceof Error ? error.message : 'Token refresh failed',
      })
    }
    revalidatePath('/settings/connections')
    return
  }
  if (!manifest || !creds) return

  const result = await manifest.test(creds)
  await saveCredentials(id, creds, {
    status: result.ok ? 'connected' : 'error',
    testDetail: result.detail,
  })
  revalidatePath('/settings/connections')
}

async function disconnect(formData: FormData) {
  'use server'
  await requireOwner()
  await deleteCredentials(String(formData.get('id')))
  revalidatePath('/settings/connections')
}

async function generateSecret(formData: FormData) {
  'use server'
  await requireOwner()
  const id = String(formData.get('id'))
  await saveCredentials(id, { secret: randomBytes(24).toString('base64url') })
  revalidatePath('/settings/connections')
}

const AUTH_LABEL = { token: 'Token', oauth2: 'OAuth2', webhook: 'Webhook' } as const
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** An `<a>` dressed as an md ActionButton. */
const linkButton = (variant: keyof typeof VARIANT) => cn(BASE, SIZE.md, VARIANT[variant])

/** Which modules named this provider in `requires`. Drives the "used by" line. */
function usedBy(id: string): string[] {
  return getModules()
    .filter((m) => (m.requires ?? []).includes(id))
    .map((m) => m.nav.label)
}


export default async function ConnectionsPage({ searchParams }: PageProps<'/settings/connections'>) {
  const params = await searchParams
  const error = typeof params.error === 'string' ? params.error : null

  const manifests = getIntegrations()
  const [statuses, timezone] = await Promise.all([getConnectionStatuses(), getSetting('timezone')])

  // Providers the owner asked for during first run that no integration backs.
  // They have to appear somewhere or the wizard's promise, that a request is
  // recorded rather than pretended, is not kept. Excluded from the connected
  // count on purpose: a wish is not a connection.
  const { rows: requested } = await db().query<{ integration_id: string; detail: string | null }>(
    `select integration_id, last_test_detail as detail
       from core.connections where status = 'requested'
      order by integration_id`,
  )
  const unbacked = requested.filter((r) => !manifests.some((m) => m.id === r.integration_id))
  const origin = await getOrigin()
  // Read once here, outside render, so the card's arithmetic is pure.
  const now = new Date()

  // Only used to decide whether a webhook secret exists, never rendered raw
  // except for the webhook secret the owner has to paste into the sender.
  const webhookSecrets = Object.fromEntries(
    await Promise.all(
      manifests
        .filter((m) => m.auth.type === 'webhook')
        .map(async (m) => [m.id, (await getCredentials(m.id))?.secret ?? null] as const),
    ),
  )

  return (
    <div className="space-y-[18px]">
      <SettingsHeader current="/settings/connections" />

      {error && <p className="text-footnote rounded-control border border-red-text/60 px-3 py-2 text-red-text">{error}</p>}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] items-stretch gap-3.5">
        {manifests.map((manifest) => (
          <ProviderCard
            key={manifest.id}
            manifest={manifest}
            status={statuses[manifest.id] ?? null}
            secret={webhookSecrets[manifest.id] ?? null}
            origin={origin}
            timezone={String(timezone)}
            now={now}
          />
        ))}
      </div>

      {unbacked.length > 0 && (
        <section className="max-w-3xl space-y-3">
          <Eyebrow dot="idle">Requested / {unbacked.length}</Eyebrow>
          <p className="text-footnote text-secondary-label">
            Asked for during first run. Nothing here syncs, because no integration in this build
            speaks to it yet. The request is kept so the intent is written down rather than
            forgotten, and so a fork knows what to build next.
          </p>
          <RowList>
            {unbacked.map((r) => (
              <Row
                key={r.integration_id}
                title={r.integration_id}
                meta={r.detail ?? 'Requested'}
                right={<StatusChip tone="quiet">No integration</StatusChip>}
              />
            ))}
          </RowList>
        </section>
      )}
    </div>
  )
}

function ProviderCard({
  manifest,
  status,
  secret,
  origin,
  timezone,
  now,
}: {
  manifest: IntegrationManifest
  /** null when nothing has ever been saved. */
  status: ConnectionStatus | null
  secret: string | null
  origin: string
  timezone: string
  now: Date
}) {
  const feeds = usedBy(manifest.id)
  const connected = Boolean(status?.connected)
  const rejected = status?.status === 'error'
  const since = status?.createdAt ? new Date(status.createdAt) : null
  const expires = status?.expiresAt ? new Date(status.expiresAt) : null
  const hoursLeft = expires ? Math.round((expires.getTime() - now.getTime()) / 3_600_000) : null

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-callout text-label">{manifest.label}</span>
            <Chip tone="quiet">{AUTH_LABEL[manifest.auth.type]}</Chip>
          </div>
          <p className="mt-1.5 text-footnote text-secondary-label">
            {manifest.description.replace(/\.$/, '')}
            {feeds.length > 0 && (
              <>
                {' '}· used by <span className="text-label">{feeds.join(', ')}</span>
              </>
            )}
          </p>
        </div>
        <StatusChip
          tone={connected ? 'ok' : rejected ? 'bad' : 'quiet'}
          className="shrink-0 whitespace-nowrap"
        >
          {connected ? 'Connected' : rejected ? 'Rejected' : 'Not connected'}
        </StatusChip>
      </div>

      {status ? (
        <>
          <MetricStrip className="mt-3.5">
            {/* The provider's own detail line goes under the verdict, not in
              * it: SimpleFIN answers with every account name. */}
            <MetricTile
              label="Last test"
              size="xs"
              valueTone={connected ? 'ok' : 'bad'}
              value={`${connected ? 'Ok' : 'Failed'}${
                status.lastTestedAt ? ` · ${clockIn(new Date(status.lastTestedAt), timezone)}` : ''
              }`}
              delta={status.lastTestDetail}
              className="[&>p]:break-words"
            />
            <MetricTile
              label={expires ? 'Token expires' : 'Connected since'}
              size="xs"
              value={
                expires && hoursLeft !== null
                  ? hoursLeft > 48
                    ? `in ${Math.round(hoursLeft / 24)} days${manifest.refresh ? ' · auto-refresh' : ''}`
                    : `in ${Math.max(0, hoursLeft)}h${manifest.refresh ? ' · auto-refresh' : ''}`
                  : since
                    ? `${since.getDate()} ${MONTHS[since.getMonth()]} ${since.getFullYear()}`
                    : ''
              }
            />
          </MetricStrip>

          {manifest.auth.type === 'webhook' && (
            <div className="mt-2.5 flex flex-col gap-2 rounded-card bg-fill-3 px-4 py-3">
              {/* Wraps rather than truncates: the phone is where this gets read, and a
                  cut-off URL cannot be checked against the one pasted into the app. */}
              <div className="flex flex-col gap-1">
                <Eyebrow>Inbound URL</Eyebrow>
                <span className="flex items-center justify-between gap-2.5">
                  <span className="num min-w-0 break-all text-footnote text-label">{`${origin}/api/integrations/${manifest.id}/webhook`}</span>
                  <Copy value={`${origin}/api/integrations/${manifest.id}/webhook`} />
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <Eyebrow>Shared secret</Eyebrow>
                {secret ? (
                  <Reveal value={secret} />
                ) : (
                  <span className="num text-footnote text-secondary-label">None yet</span>
                )}
              </div>
            </div>
          )}

          {connected && manifest.panel && <ProviderPanel load={manifest.panel} />}

          <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
            <form action={test}>
              <input type="hidden" name="id" value={manifest.id} />
              <ActionButton type="submit">Test</ActionButton>
            </form>
            {/* A link, not a form: next.config.ts sets `form-action 'self'`
              * and Chrome applies it to a submission's redirect, which here is
              * the provider. The arrow says it leaves the app. */}
            {manifest.auth.type === 'oauth2' && (
              <a href={`/api/integrations/${manifest.id}/oauth/start`} className={linkButton('quiet')}>
                Reauthorize <span aria-hidden="true">&#8599;</span>
                <span className="sr-only">, opens {manifest.label}</span>
              </a>
            )}
            <form action={disconnect} className="ml-auto">
              <input type="hidden" name="id" value={manifest.id} />
              <ConfirmButton
                submit
                confirmLabel="Disconnect"
                title={`Disconnect ${manifest.label}?`}
                message="Its stored credentials are deleted."
                className="border-0 px-1 text-footnote text-secondary-label hover:text-red-text"
              >
                Disconnect
              </ConfirmButton>
            </form>
          </div>
        </>
      ) : (
        <>
          {manifest.auth.type === 'token' && (
            <form action={save} className="mt-3.5 flex flex-col gap-3.5">
              <input type="hidden" name="id" value={manifest.id} />
              {manifest.auth.fields.map((f) => (
                <label key={f.key} className="flex flex-col gap-2">
                  <Eyebrow>{f.label}</Eyebrow>
                  <input
                    name={f.key}
                    type={f.secret ? 'password' : 'text'}
                    placeholder={f.placeholder}
                    autoComplete="off"
                    className={`${fieldClass} num`}
                  />
                </label>
              ))}
              <div className="flex flex-wrap items-center gap-2.5">
                <ActionButton type="submit" variant="solid">
                  Save &amp; test <span aria-hidden="true">&rarr;</span>
                </ActionButton>
                <span className="text-footnote text-secondary-label">Tests on save</span>
              </div>
            </form>
          )}
          {manifest.auth.type === 'oauth2' && (
            <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
              <a href={`/api/integrations/${manifest.id}/oauth/start`} className={linkButton('solid')}>
                Connect with {manifest.label} <span aria-hidden="true">&#8599;</span>
              </a>
              <span className="text-footnote text-secondary-label">Opens {manifest.label}</span>
            </div>
          )}
          {manifest.auth.type === 'webhook' && (
            <form action={generateSecret} className="mt-3.5 flex flex-wrap items-center gap-2.5">
              <input type="hidden" name="id" value={manifest.id} />
              <ActionButton type="submit" variant="solid">
                Enable webhook <span aria-hidden="true">&rarr;</span>
              </ActionButton>
              <span className="text-footnote text-secondary-label">Generates a URL and shared secret</span>
            </form>
          )}
        </>
      )}
    </Card>
  )
}

/** A provider's own settings under its card, loaded only for a connected one. */
async function ProviderPanel({ load }: { load: NonNullable<IntegrationManifest['panel']> }) {
  const Panel = await load()
  return <Panel />
}
