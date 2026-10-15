import Link from 'next/link'
import { Card, Eyebrow } from '@/components/pos'
import { getModule } from '@/core/modules'
import { isLive, type Channel, type Rule } from '@/core/notification-rules'
import { listRules } from '@/core/notify'
import { getSettings } from '@/core/settings'
import { SettingsHeader } from '../tabs'
import { listSubscriptions, publicKey } from '@/core/push'
import { ChannelGrid, type CellState, type ModuleRow } from './ChannelGrid'
import { Channels } from './Channels'
import { Devices } from './Devices'
import { QuietHours } from './QuietHours'

// The coarse view of the same rules the Notifications screen edits one at a
// time. A switch here writes every rule in that module, which is the thing you
// want when a whole module has gone noisy and the thing the rules table makes
// tedious.

const CHANNELS: { value: Channel; label: string; sub: (digestHour: number) => string }[] = [
  { value: 'email', label: 'Email digest', sub: (h) => `Once daily at ${String(h).padStart(2, '0')}:00 via Resend` },
  { value: 'push', label: 'Push', sub: () => 'Phone + desktop, respects quiet hours' },
  { value: 'inapp', label: 'In-app', sub: () => 'Warnings tile and badges' },
]

function label(id: string): string {
  if (id === 'system') return 'System'
  return getModule(id)?.nav.label ?? id[0].toUpperCase() + id.slice(1)
}

export default async function NotificationSettingsPage() {
  const [rules, settings, devices] = await Promise.all([
    listRules(),
    getSettings(),
    listSubscriptions(),
  ])
  const paused = settings.notifications_paused

  const modules = [...new Set(rules.map((r) => r.module))]

  const rows: ModuleRow[] = modules.map((id) => {
    const mine = rules.filter((r) => r.module === id)
    const live = mine.filter((r) => isLive(r, paused))

    // A column is on when every rule in the module has it, and the grid shows
    // the in between state rather than rounding it to on or off.
    const state = (has: (r: Rule) => boolean) => {
      const on = mine.filter(has).length
      return on === 0 ? 'off' : on === mine.length ? 'on' : 'some'
    }

    return {
      id,
      label: label(id),
      digest: state((r) => r.timing !== 'immediate'),
      push: state((r) => r.channels.includes('push')),
      inapp: state((r) => r.channels.includes('inapp')),
      triggers: mine
        .map((r) => r.label.toLowerCase())
        .slice(0, 3)
        .join(', '),
      liveCount: live.length,
      ruleCount: mine.length,
    }
  })

  const channelState = (channel: Channel): CellState => {
    const on = rules.filter((r) => r.channels.includes(channel)).length
    return on === 0 ? 'off' : on === rules.length ? 'on' : 'some'
  }

  return (
    <div className="space-y-[18px]">
      <SettingsHeader current="/settings/notifications" />

      <div className="flex max-w-[860px] flex-col gap-3.5">
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <Eyebrow>Channels</Eyebrow>
            <span className="text-footnote text-secondary-label">Per module below</span>
          </div>
          <Channels
            channels={CHANNELS.map((c) => ({
              value: c.value,
              label: c.label,
              sub: c.sub(settings.digest_hour),
              state: channelState(c.value),
            }))}
          />
        </Card>

        <Card>
          <Eyebrow>Per module</Eyebrow>
          <ChannelGrid rows={rows} paused={paused} />
          <p className="text-footnote mt-3 text-secondary-label">
            <Link href="/notifications" className="border-b border-separator text-secondary-label hover:text-label">
              The Notifications screen
            </Link>{' '}
            edits one rule at a time, with lead times, urgency and per-rule snooze.
          </p>
        </Card>

        <Card>
          <Eyebrow>Quiet hours</Eyebrow>
          <QuietHours
            from={settings.quiet_from}
            to={settings.quiet_to}
            urgentOverride={settings.quiet_urgent_override}
          />
        </Card>

        <Devices
          vapidPublicKey={publicKey()}
          devices={devices.map((d) => ({
            id: d.id,
            label: d.label,
            lastSentAt: d.last_sent_at ? d.last_sent_at.toISOString().slice(0, 10) : null,
            failures: d.failure_count,
          }))}
        />
      </div>
    </div>
  )
}
