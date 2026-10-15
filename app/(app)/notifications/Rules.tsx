'use client'

import { useState, useTransition } from 'react'
import {
  ActionButton,
  Card,
  CardHead,
  EmptyState,
  Eyebrow,
  PillGroup,
  Row,
  RowList,
  StatusChip,
  Switch,
  timeFieldClass as timeField,
  useToast,
} from '@/components/pos'
import { useOptimisticAction } from '@/components/pos/useOptimisticAction'
import { isLive, leadLabel, leadOptions, ruleState, type Rule, type RulePatch } from '@/core/notification-rules'
import { cn } from '@/lib/utils'
import { snooze, updateRule, updateSchedule } from './actions'
import type { ActionResult } from './actions'

type RulesPatch = { id: string; changes: RulePatch }

// The rules table, the schedule above it and the preview rail all read the same
// rule set, and the rail follows the row you last touched, so the three are one
// client component rather than three that would have to sync a selection.

export type Schedule = {
  morningAt: string
  morningEnabled: boolean
  eveningAt: string
  eveningEnabled: boolean
  quietFrom: string
  quietTo: string
  urgentOverride: boolean
  paused: boolean
  digestEmail: string
}

const CHANNELS = [
  { value: 'push' as const, label: 'Push' },
  { value: 'email' as const, label: 'Email' },
  { value: 'inapp' as const, label: 'In-app' },
]

const TIMINGS = [
  { value: 'immediate' as const, label: 'Immediate' },
  { value: 'morning' as const, label: 'Morning' },
  { value: 'evening' as const, label: 'Evening' },
]

function channelLabel(rule: Rule): string {
  const on = CHANNELS.filter((c) => rule.channels.includes(c.value)).map((c) => c.label)
  return on.length > 0 ? on.join(' · ') : 'None'
}

function timingLabel(rule: Rule): string {
  const base = TIMINGS.find((t) => t.value === rule.timing)?.label ?? rule.timing
  return rule.lead_days ? `${base} · ${leadLabel(rule.lead_days)}` : base
}

// Module colour on a live rule's row: accent for most modules, orange for
// insurance, label for system, matching the artboard's MODS table. Secondary once
// the rule is not live, whatever the module.
const MOD_TONE: Record<string, string> = { insurance: 'text-orange-text', system: 'text-label' }
function moduleTone(module: string, live: boolean): string {
  return live ? (MOD_TONE[module] ?? 'text-accent') : 'text-secondary-label'
}

/** What the expander says the rule will actually do, in one sentence. */
function stateNote(rule: Rule): string {
  if (rule.muted) return 'Muted indefinitely. Still recorded in the alert centre.'
  if (rule.snooze_until && rule.snooze_until > new Date()) {
    // The day count, not the state chip's compact "3D" label: the chip is for
    // a tag, this sentence needs "3 days".
    const days = Math.max(1, Math.ceil((rule.snooze_until.getTime() - Date.now()) / 86_400_000))
    return `Snoozed for ${days} day${days > 1 ? 's' : ''}, then back on.`
  }
  const count = rule.channels.length
  if (count === 0) return 'Active, but no channel is selected, so nothing is sent.'
  return `Active. ${count} channel${count > 1 ? 's' : ''}.`
}

export function Notifications({
  rules,
  schedule,
  moduleLabels,
  children,
}: {
  rules: Rule[]
  schedule: Schedule
  /** Module id to display name, so the table shows "Finance" not "finance". */
  moduleLabels: Record<string, string>
  /** The alert centre, rendered under the rules in the same column. */
  children: React.ReactNode
}) {
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState(rules[0]?.id ?? '')
  const [open, setOpen] = useState(rules[0]?.id ?? '')
  const [pending, start] = useTransition()
  const toast = useToast()

  // Every schedule write goes through here so a refusal is spoken once, in
  // one place, rather than swallowed per control.
  const run = (action: () => Promise<ActionResult>) =>
    start(async () => {
      const result = await action()
      if (!result.ok) toast(result.error)
    })

  // Per-rule edits flip the row immediately: this table is the whole reason
  // for optimistic UI here, since a rule's own screen is where its state is
  // read back, not just glanced at.
  const [liveRules, runRule] = useOptimisticAction<Rule[], RulesPatch, ActionResult>(
    rules,
    (state, patch) => state.map((r) => (r.id === patch.id ? { ...r, ...patch.changes } : r)),
  )

  const modules = [...new Set(liveRules.map((r) => r.module))]
  const shown = filter === 'all' ? liveRules : liveRules.filter((r) => r.module === filter)
  const selectedRule = liveRules.find((r) => r.id === selected) ?? liveRules[0]

  const liveCount = (timing: Rule['timing']) =>
    liveRules.filter((r) => isLive(r, schedule.paused) && r.timing === timing).length

  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-7">
      <div
        className={cn(
          'flex min-w-0 flex-[1_1_520px] flex-col gap-7',
          pending && 'pointer-events-none opacity-100',
        )}
      >
        {/* Schedule ------------------------------------------------------- */}
        <Card className="space-y-4">
          <CardHead
            label="Schedule"
            meta={`Quiet ${schedule.quietFrom}–${schedule.quietTo} · ${
              schedule.urgentOverride ? 'urgent overrides' : 'no overrides'
            }`}
          />

          <div className="grid gap-[18px] sm:grid-cols-[repeat(auto-fit,minmax(min(100%,210px),1fr))]">
            <div className="space-y-2">
              <p className="text-footnote text-secondary-label">Morning digest</p>
              <div className="flex items-center gap-2.5">
                {/* Not an input. The digest goes out when the nightly cron
                  * fires, and there is one run a day, so no setting here could
                  * move it. This used to be a time picker whose value nothing
                  * read: it looked like a control and was a decoration. */}
                <span
                  aria-label="Morning digest time"
                  className={cn(timeField, 'inline-flex items-center tabular-nums')}
                  title="Set by the nightly cron in vercel.json"
                >
                  {schedule.morningAt}
                </span>
                <Switch
                  label="Morning digest on"
                  checked={schedule.morningEnabled}
                  onChange={(next) => run(() => updateSchedule('digest_morning_enabled', next))}
                />
              </div>
              <p className="text-footnote text-secondary-label">
                {schedule.morningEnabled
                  ? `When the nightly run fires, your time. ${liveCount('morning')} rules batch into it`
                  : 'Off, so morning rules fall back to in-app only'}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-footnote text-secondary-label">Evening digest</p>
              <div className="flex items-center gap-2.5">
                <input
                  type="time"
                  aria-label="Evening digest time"
                  defaultValue={schedule.eveningAt}
                  onBlur={(e) => run(() => updateSchedule('digest_evening_at', e.target.value))}
                  className={timeField}
                />
                <Switch
                  label="Evening digest on"
                  checked={schedule.eveningEnabled}
                  onChange={(next) => run(() => updateSchedule('digest_evening_enabled', next))}
                />
              </div>
              <p className="text-footnote text-secondary-label">
                {schedule.eveningEnabled
                  ? `${liveCount('evening')} rules batch into it`
                  : 'Off, so evening rules fall back to in-app only'}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-footnote text-secondary-label">Quiet hours</p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="time"
                  aria-label="Quiet hours start"
                  defaultValue={schedule.quietFrom}
                  onBlur={(e) => run(() => updateSchedule('quiet_from', e.target.value))}
                  className={timeField}
                />
                <span className="text-footnote text-secondary-label">to</span>
                <input
                  type="time"
                  aria-label="Quiet hours end"
                  defaultValue={schedule.quietTo}
                  onBlur={(e) => run(() => updateSchedule('quiet_to', e.target.value))}
                  className={timeField}
                />
              </div>
              <ActionButton
                variant={schedule.urgentOverride ? 'brand' : 'outline'}
                onClick={() =>
                  run(() => updateSchedule('quiet_urgent_override', !schedule.urgentOverride))
                }
              >
                {schedule.urgentOverride ? 'Urgent breaks through' : 'Nothing breaks through'}
              </ActionButton>
            </div>
          </div>
        </Card>

        {/* Rules ---------------------------------------------------------- */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
            <Eyebrow>Rules</Eyebrow>
            <PillGroup
              label="Filter rules by module"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All', count: liveRules.length },
                ...modules.map((m) => ({
                  value: m,
                  label: moduleLabels[m] ?? m,
                  count: liveRules.filter((r) => r.module === m).length,
                })),
              ]}
            />
          </div>

          <div className="text-footnote flex flex-wrap gap-x-3 gap-y-1 border-b border-opaque-separator px-1 pb-2.5 text-secondary-label">
            <span className="min-w-0 flex-1">Rule</span>
            <span>Channels · timing · state</span>
          </div>

          <RowList>
            {shown.map((rule) => {
              const state = ruleState(rule, schedule.paused)
              const live = isLive(rule, schedule.paused)
              const isOpen = open === rule.id
              const leads = leadOptions(rule.module)

              return (
                <Row
                  key={rule.id}
                  // An open rule is marked by the inset accent ring alone, as
                  // Second Brain's selected row is: an accent tint pushes
                  // secondary-label under 4.5:1 in light.
                  className={cn(isOpen && 'bg-grouped-2 ring-2 ring-inset ring-accent')}
                  muted={!live}
                  expanded={isOpen}
                  onClick={() => {
                    setSelected(rule.id)
                    setOpen(isOpen ? '' : rule.id)
                  }}
                  title={
                    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className={cn('label', moduleTone(rule.module, live))}>
                        {moduleLabels[rule.module] ?? rule.module}
                      </span>
                      {rule.label}
                    </span>
                  }
                  meta={rule.trigger_text}
                  right={
                    <>
                      <span className="text-footnote text-secondary-label">{channelLabel(rule)}</span>
                      <span className="text-footnote text-secondary-label">{timingLabel(rule)}</span>
                      <StatusChip
                        tone={
                          state.tone === 'on' ? 'brand' : state.tone === 'snoozed' ? 'warn' : 'quiet'
                        }
                      >
                        {state.label}
                      </StatusChip>
                    </>
                  }
                >
                  {isOpen && (
                    <div
                      // The row itself toggles the expander, so clicks on a
                      // control inside must not bubble back up and close it.
                      onClick={(e) => e.stopPropagation()}
                      className="grid gap-5 border-t border-separator pt-4 sm:grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))]"
                    >
                      <div className="space-y-2.5">
                        <Eyebrow>Channels</Eyebrow>
                        <PillGroup
                          multiple
                          label={`Channels for ${rule.label}`}
                          value={rule.channels}
                          options={CHANNELS}
                          onChange={(next) => {
                            const channels = rule.channels.includes(next)
                              ? rule.channels.filter((c) => c !== next)
                              : [...rule.channels, next]
                            runRule({ id: rule.id, changes: { channels } }, () =>
                              updateRule(rule.id, { channels }),
                            )
                          }}
                        />
                      </div>

                      <div className="space-y-2.5">
                        <Eyebrow>Timing</Eyebrow>
                        <PillGroup
                          label={`Timing for ${rule.label}`}
                          value={rule.timing}
                          options={TIMINGS}
                          onChange={(timing) =>
                            runRule({ id: rule.id, changes: { timing } }, () => updateRule(rule.id, { timing }))
                          }
                        />
                      </div>

                      <div className="space-y-2.5">
                        <Eyebrow>Lead time</Eyebrow>
                        <PillGroup
                          label={`Lead time for ${rule.label}`}
                          value={String(rule.lead_days)}
                          options={leads.map((v) => ({ value: String(v), label: leadLabel(v) }))}
                          onChange={(v) => {
                            const lead_days = Number(v)
                            runRule({ id: rule.id, changes: { lead_days } }, () =>
                              updateRule(rule.id, { lead_days }),
                            )
                          }}
                        />
                      </div>

                      <div className="space-y-2.5">
                        <Eyebrow>Urgency</Eyebrow>
                        <ActionButton
                          variant={rule.urgent ? 'brand' : 'outline'}
                          onClick={() => {
                            const urgent = !rule.urgent
                            runRule({ id: rule.id, changes: { urgent } }, () => updateRule(rule.id, { urgent }))
                          }}
                        >
                          {rule.urgent ? 'Breaks quiet hours' : 'Respects quiet hours'}
                        </ActionButton>
                        <p className="text-footnote text-secondary-label">
                          {rule.urgent
                            ? `Delivered even between ${schedule.quietFrom} and ${schedule.quietTo}.`
                            : `Held until ${schedule.quietTo} if it fires overnight.`}
                        </p>
                      </div>

                      <div className="space-y-2.5">
                        <Eyebrow>Snooze / mute</Eyebrow>
                        <div className="flex flex-wrap gap-1.5">
                          {[1, 7].map((days) => (
                            <ActionButton
                              key={days}
                              onClick={() => {
                                const snooze_until = new Date(Date.now() + days * 86_400_000)
                                runRule({ id: rule.id, changes: { snooze_until } }, () => snooze(rule.id, days))
                              }}
                            >
                              {days}d
                            </ActionButton>
                          ))}
                          <ActionButton
                            variant={rule.muted ? 'brand' : 'outline'}
                            onClick={() => {
                              const changes = { muted: !rule.muted, snooze_until: null }
                              runRule({ id: rule.id, changes }, () => updateRule(rule.id, changes))
                            }}
                          >
                            {rule.muted ? 'Unmute' : 'Mute'}
                          </ActionButton>
                        </div>
                        <p className="text-footnote text-secondary-label">{stateNote(rule)}</p>
                      </div>
                    </div>
                  )}
                </Row>
              )
            })}
          </RowList>

          {shown.length === 0 && (
            <EmptyState headline="No rules here">
              {moduleLabels[filter] ?? filter} has no notification rules yet. One arrives with the
              module that raises the alert.
            </EmptyState>
          )}
        </section>

        {children}
      </div>

      {selectedRule && (
        <Preview rule={selectedRule} schedule={schedule} moduleLabels={moduleLabels} rules={rules} />
      )}
    </div>
  )
}

/**
 * The rail: what this rule looks like on a lock screen, and what the digest it
 * batches into looks like in an inbox. Both follow the selected row.
 */
function Preview({
  rule,
  rules,
  schedule,
  moduleLabels,
}: {
  rule: Rule
  rules: Rule[]
  schedule: Schedule
  moduleLabels: Record<string, string>
}) {
  const moduleLabel = moduleLabels[rule.module] ?? rule.module
  const isMorning = rule.timing !== 'evening'
  const digestAt = isMorning ? schedule.morningAt : schedule.eveningAt

  const clock = rule.timing === 'immediate' ? '14:26' : digestAt
  const when = rule.timing === 'immediate' ? 'now' : `digest ${digestAt}`

  const channels = rule.channels.map((c) => (c === 'inapp' ? 'in-app' : c))
  const pushNote = !rule.channels.includes('push')
    ? `Push is off for this rule, so it arrives by ${
        channels.length > 0 ? channels.join(' and ') : 'nothing'
      }.`
    : rule.urgent && schedule.urgentOverride
      ? 'Urgent, so it is delivered even inside quiet hours.'
      : `Held until ${schedule.quietTo} if it fires inside quiet hours.`

  // What the digest would contain: every live rule batching into the same slot,
  // grouped by module, one sample line each.
  const batched = rules.filter(
    (r) =>
      isLive(r, schedule.paused) &&
      r.timing === (isMorning ? 'morning' : 'evening') &&
      (r.channels.includes('email') || r.channels.includes('push')),
  )
  const sections = [...new Set(batched.map((r) => r.module))].map((m) => ({
    module: moduleLabels[m] ?? m,
    lines: batched.filter((r) => r.module === m).map((r) => r.sample_title),
  }))

  return (
    <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-6 xl:max-w-[420px]">
      <div className="flex items-baseline justify-between gap-3">
        <Eyebrow>Preview</Eyebrow>
        <span className="text-footnote text-secondary-label">{moduleLabel}</span>
      </div>

      <div className="space-y-3">
        <Eyebrow>Push, lock screen</Eyebrow>
        {/* Fixed dark ground on purpose: a phone lock screen is dark whatever
            theme the app is in, so the preview would lie if it followed it. */}
        {/* White at 60% is the faintest text here: 45% measured about 4.4:1. */}
        <div className="space-y-3.5 rounded-card bg-neutral-950 p-4 text-white">
          <div className="text-center">
            <p className="text-footnote text-white/60">Thu 7 Sep</p>
            <p className="num mt-0.5 text-large-title">{clock}</p>
          </div>
          <div className="rounded-control border border-white/10 bg-white/8 px-3.5 py-3">
            <div className="flex items-baseline justify-between gap-2.5">
              <span className="text-caption-1 text-white/70">Holon / {moduleLabel}</span>
              <span className="text-caption-1 text-white/60">{when}</span>
            </div>
            <p className="mt-2 text-subheadline">{rule.sample_title}</p>
            <p className="mt-1 text-footnote text-white/70">{rule.sample_body}</p>
          </div>
          <p className="text-center text-footnote text-white/60">{pushNote}</p>
        </div>
      </div>

      <div className="space-y-3">
        <Eyebrow>
          Email, {isMorning ? 'morning' : 'evening'} digest
        </Eyebrow>
        <div className="rounded-card bg-grouped-2">
          <div className="space-y-1 border-b border-separator px-4 py-3.5">
            <p className="text-body text-label">
              {isMorning ? 'Your morning digest' : 'Evening wrap'}, Thu 7 Sep
            </p>
            <p className="text-footnote text-secondary-label">
              {schedule.digestEmail} · {digestAt}
            </p>
          </div>

          {sections.length === 0 ? (
            <div className="p-4">
              <EmptyState headline="Nothing batched" className="border-0 px-0 py-2">
                Every active rule delivers immediately. Set one to Morning or Evening to batch it
                here.
              </EmptyState>
            </div>
          ) : (
            <div className="divide-y divide-separator">
              {sections.map((s) => (
                <div key={s.module} className="space-y-2 px-4 py-3.5">
                  <div className="flex items-baseline justify-between gap-3">
                    {/* Plain spans, not Eyebrow/Chip: the artboard's module
                      * label is flat accent (Eyebrow is fixed secondary-label) and its
                      * count is plain mono text, not a pill. */}
                    <span className="label text-accent">
                      {s.module}
                    </span>
                    <span className="text-footnote num text-secondary-label">
                      {s.lines.length} item{s.lines.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  {s.lines.map((line) => (
                    <div key={line} className="flex items-baseline gap-2.5 border-b border-separator py-1.5">
                      <span aria-hidden className="size-[5px] shrink-0 rounded-full bg-secondary-label" />
                      <p className="text-footnote text-label">{line}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          <p className="text-footnote border-t border-separator px-4 py-3 text-secondary-label">
            {sections.length > 0
              ? `Batched from ${batched.length} rules. Mute a rule to drop it from this digest.`
              : 'Turn a rule to Morning or Evening to batch it here.'}
          </p>
        </div>
      </div>
    </aside>
  )
}
