'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import {
  ActionButton,
  Card,
  Chip,
  EmptyState,
  Eyebrow,
  Row,
  RowList,
  Switch,
  WizardShell,
  fieldClass,
  useToast,
} from '@/components/pos'
import { BASE, SIZE, VARIANT } from '@/components/pos/button-classes'
import { useSearchState } from '@/components/pos/searchState'
import type { Category } from '@/core/connectors'
import type { Metric } from '@/core/metrics'
import { cn } from '@/lib/utils'
import {
  finish,
  removeProvider,
  requestProvider,
  saveSetting,
  seedGoals,
  type ActionResult,
  type GoalSeed,
} from './actions'

// Six steps, and every one writes as it goes. There is no submit at the end:
// the wizard is a guided tour of settings that already exist, so leaving
// halfway through leaves a half configured app rather than nothing, and coming
// back resumes because the settings are the state.

export type SetupData = {
  ownerName: string
  timezone: string
  modules: { id: string; label: string; note: string; enabled: boolean }[]
  categories: Category[]
  supported: string[]
  requested: string[]
  metrics: Metric[]
  hasGoals: boolean
  todayIso: string
  nightlyAt: string
  schedule: {
    morningEnabled: boolean
    eveningAt: string
    eveningEnabled: boolean
    quietFrom: string
    quietTo: string
    urgentOverride: boolean
  }
  completedAt: string
}

type StepKey = 'you' | 'modules' | 'connect' | 'goals' | 'notify' | 'ready'

// Title, lede and rail hint are the artboard's own copy (logic line 63 to 107,
// 414 to 421), kept verbatim wherever it is true. Two clauses are not: step
// one's "and a wake time" (the day-start picker is not built, see the plan's
// decision) and step six's line, which moves to the First run card below
// rather than staying here (see firstRunLine).
const STEPS: { key: StepKey; name: string; hint: string; question: string; helper: string }[] = [
  {
    key: 'you',
    name: 'You',
    hint: 'Name, zone, day start',
    question: 'Start with the basics',
    helper: 'The agent writes in your name and runs on your clock. Two fields are all it needs.',
  },
  {
    key: 'modules',
    name: 'Modules',
    hint: 'What the OS tracks',
    question: 'Choose what it tracks',
    helper:
      'This decides which connectors matter on the next step. Every module can be added later without losing history.',
  },
  {
    key: 'connect',
    name: 'Connections',
    hint: 'By category, per module',
    question: 'Connect what it should read',
    helper:
      'Grouped by what the data is for. Categories belonging to modules you left off are greyed out; turn the module on right here if you want them.',
  },
  {
    key: 'goals',
    name: 'Goals',
    hint: 'Seed three to start',
    question: 'Seed a few goals',
    helper: 'Goals read from your data where they can, so progress moves without you updating anything.',
  },
  {
    key: 'notify',
    name: 'Notifications',
    hint: 'Digest and quiet hours',
    question: 'Decide how loud it is',
    helper: 'Pick a starting point. Individual rules stay editable, per module and per channel.',
  },
  {
    key: 'ready',
    name: 'First run',
    hint: 'Review and finish',
    question: 'Ready for the first run',
    // Computed below (needs the real nightly hour), not static.
    helper: '',
  },
]

/**
 * Categories with nothing requested that leave a real tile empty: the
 * dashboard's net worth and the runway goal both read Finance's balances.
 * Named here rather than added to config/connectors.yaml, since a plain
 * array of the ids that already exist there is the smaller, in-scope change.
 */
const NEEDED_CATEGORY_IDS = ['bank', 'broker']

/** "Banks and credit unions" to "Banks & credit unions", the artboard's own style. */
const withAmpersand = (name: string) => name.replace(/ and /g, ' & ')

/** "balances and transactions" to "balances, transactions": the category's
 * true `data` field, rephrased into the artboard's comma list shape rather
 * than prose, without adding an item it does not actually give. */
const listify = (data: string) => data.replace(/ and /g, ', ')

/**
 * Three quiet-hours shortcuts. There is no per-rule loudness setting to
 * pick between (core.settings has only the two digest toggles and one quiet
 * window), so each preset only ever writes the quiet-hours width and the
 * urgent override, the same two fields the panel below already saves. No
 * per-day notification count is shown: nothing here counts real rules, so a
 * number would be invented.
 */
const NOTIFY_PRESETS = [
  {
    id: 'quiet',
    tag: 'Lightest',
    name: 'Digest only',
    note: 'Everything batches into the morning and evening digest. Nothing interrupts.',
    quietFrom: '00:00',
    quietTo: '23:59',
    override: false,
  },
  {
    id: 'balanced',
    tag: 'Recommended',
    name: 'Money and deadlines',
    note: 'Quiet hours hold the rest; an urgent rule still breaks through.',
    quietFrom: '22:00',
    quietTo: '06:30',
    override: true,
  },
  {
    id: 'all',
    tag: 'Loudest',
    name: 'Tell me everything',
    note: 'No quiet hours at all. Useful for the first week, then trim it.',
    quietFrom: '00:00',
    quietTo: '00:00',
    override: true,
  },
] as const

/**
 * Goals a fresh install can start from.
 *
 * Each one names a metric it would like. Whether that metric exists is decided
 * at render against the registry, so a fork without Finance is offered the two
 * that do not need it rather than three that would never compute.
 */
const STARTER_GOALS: (GoalSeed & { wants: string | null; blurb: string })[] = [
  {
    title: 'Six months of runway',
    area: 'Life ops',
    kind: 'number',
    unit: '$',
    target_value: 30_000,
    deadline: '',
    metric_source: null,
    wants: 'finance.liquid',
    blurb: 'Cash on hand, from the accounts you connect.',
  },
  {
    title: 'Clear the week every week',
    area: 'Engineering',
    kind: 'streak',
    unit: '/wk',
    target_value: 10,
    deadline: '',
    metric_source: null,
    wants: 'tasks.completed_this_week',
    blurb: 'Tasks finished per week, counted for you.',
  },
  {
    title: 'Read twelve books this year',
    area: 'Communication',
    kind: 'count',
    unit: 'books',
    target_value: 12,
    deadline: '',
    metric_source: null,
    wants: null,
    blurb: 'Checked in by hand, one line per finish.',
  },
]

export function Onboarding({ data }: { data: SetupData }) {
  const { params, set: setParams } = useSearchState()
  const step = (STEPS.find((s) => s.key === params.get('step'))?.key ?? 'you') as StepKey

  const setStep = (next: StepKey) => setParams({ step: next === 'you' ? null : next })

  const [enabled, setEnabled] = useState(
    data.modules.filter((m) => m.enabled).map((m) => m.id),
  )
  const [picked, setPicked] = useState<string[]>([])
  const [goalCfg, setGoalCfg] = useState<Record<string, { target?: string; deadline?: string }>>(
    {},
  )
  const [openCategory, setOpenCategory] = useState<string | null>(null)
  const [connectSearch, setConnectSearch] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [manualValue, setManualValue] = useState('')
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [done, setDone] = useState(data.completedAt !== '')
  const [pending, start] = useTransition()
  const toast = useToast()

  const supported = new Set(data.supported)
  const requested = new Set(data.requested)
  const metricIds = new Set(data.metrics.map((m) => m.id))

  const run = (action: () => Promise<ActionResult>, ok?: string) =>
    start(async () => {
      const result = await action()
      if (!result.ok) toast(result.error)
      else if (ok) toast(ok)
    })

  const index = STEPS.findIndex((s) => s.key === step)
  const stage = STEPS[index]

  const toggleModule = (id: string) => {
    const next = enabled.includes(id) ? enabled.filter((m) => m !== id) : [...enabled, id]
    setEnabled(next)
    run(() => saveSetting('modules_enabled', next))
  }

  // A year out, so a starter goal has room to be wrong about its date without
  // being overdue on the day it is created. The default the TARGET and BY
  // WHEN inputs show, and what a goal falls back to if left blank or typed
  // as something that does not parse.
  const [defaultYear, defaultMonth, defaultDay] = data.todayIso.split('-').map(Number)
  const defaultDeadline = `${defaultYear + 1}-${String(defaultMonth).padStart(2, '0')}-${String(defaultDay).padStart(2, '0')}`

  const finishUp = () =>
    start(async () => {
      if (picked.length > 0 && data.hasGoals) {
        const goals = STARTER_GOALS.filter((g) => picked.includes(g.title)).map((g) => {
          const typedTarget = Number((goalCfg[g.title]?.target ?? '').replace(/[^0-9.-]/g, ''))
          return {
            title: g.title,
            area: g.area,
            kind: g.kind,
            unit: g.unit,
            target_value: Number.isFinite(typedTarget) && typedTarget > 0 ? typedTarget : g.target_value,
            deadline: goalCfg[g.title]?.deadline || defaultDeadline,
            // Only when something really provides it. A goal pointed at a metric
            // that does not exist would sit at zero forever looking broken.
            metric_source: g.wants && metricIds.has(g.wants) ? g.wants : null,
          }
        })
        const seeded = await seedGoals(goals)
        if (!seeded.ok) toast(seeded.error)
      }

      const result = await finish()
      if (!result.ok) {
        toast(result.error)
        return
      }
      setDone(true)
    })

  if (done) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-7">
        <Eyebrow dot="ok">First run complete</Eyebrow>
        <EmptyState headline="You are set up">
          Every answer you gave is a setting, and every one of them is editable. The nightly job
          takes it from here.
        </EmptyState>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/"
            className={cn(BASE, SIZE.md, VARIANT.primary)}
          >
            Go to the dashboard
          </Link>
          <Link
            href="/settings/connections"
            className={cn(BASE, SIZE.md, VARIANT.normal)}
          >
            Connect a provider
          </Link>
        </div>
      </div>
    )
  }

  return (
    <WizardShell
      railTitle={`Set up in ${STEPS.length} steps`}
      railLede="Nothing is shared. Every connection can be revoked later in Settings."
      steps={STEPS.map((s) => ({ key: s.key, name: s.name, hint: s.hint }))}
      current={step}
      onStep={(key) => setStep(key as StepKey)}
      kicker={
        <span className="text-accent">
          Step {index + 1} of {STEPS.length}
        </span>
      }
      title={stage.question}
      helper={
        step === 'ready'
          ? `The agent will do a full pass tonight at ${data.nightlyAt} and write its first digest for the morning.`
          : stage.helper
      }
      onBack={index > 0 ? () => setStep(STEPS[index - 1].key) : undefined}
      onSkip={index < STEPS.length - 1 ? () => setStep(STEPS[index + 1].key) : undefined}
      onNext={index === STEPS.length - 1 ? finishUp : () => setStep(STEPS[index + 1].key)}
      nextLabel={index === STEPS.length - 1 ? 'Open the dashboard' : 'Continue'}
      nextVariant="accent"
      backVariant="outline"
      footnote={
        pending
          ? 'Saving.'
          : index === STEPS.length - 1
            ? 'Setup takes effect immediately'
            : 'Everything is editable later'
      }
    >
      {step === 'you' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <Eyebrow>What to call you</Eyebrow>
            <input
              defaultValue={data.ownerName}
              aria-label="Your name"
              placeholder="Nick"
              onBlur={(e) => run(() => saveSetting('owner_name', e.target.value))}
              className={cn(fieldClass, 'w-full')}
            />
          </label>
          <label className="block space-y-1.5">
            <Eyebrow>Timezone</Eyebrow>
            <input
              defaultValue={data.timezone}
              aria-label="Timezone"
              placeholder="America/Chicago"
              onBlur={(e) => run(() => saveSetting('timezone', e.target.value))}
              className={cn(fieldClass, 'w-full')}
            />
            <p className="text-footnote text-secondary-label">
              An IANA name. Every date in the app is computed from it, so a task due today is due
              today where you are.
            </p>
          </label>
        </div>
      )}

      {step === 'modules' && (
        <div className="space-y-4">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,230px),1fr))] gap-2.5">
            {data.modules.map((m, i) => {
              const on = enabled.includes(m.id)
              return (
                <Card key={m.id} selected={on} className="p-0">
                  <button
                    type="button"
                    onClick={() => toggleModule(m.id)}
                    className="w-full rounded-card p-4 text-left transition-colors duration-150 hover:bg-fill-4"
                  >
                    <span className="flex items-baseline justify-between gap-2.5">
                      <span
                        className={cn(
                          'label',
                          on ? 'text-accent' : 'text-secondary-label',
                        )}
                      >
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span
                        className={cn(
                          'label',
                          on ? 'text-accent' : 'text-secondary-label',
                        )}
                      >
                        {on ? 'On' : 'Off'}
                      </span>
                    </span>
                    <span className="mt-2.5 block text-subheadline text-label">{m.label}</span>
                    <span className="mt-1 block text-caption-1 text-secondary-label">
                      {m.note}
                    </span>
                  </button>
                </Card>
              )
            })}
          </div>
          <p className="text-footnote text-secondary-label">
            {enabled.length} of {data.modules.length} on.{' '}
            {data.categories.filter((c) => enabled.includes(c.module)).length} connector
            categories unlock on the next step; the rest stay visible but greyed.
          </p>
        </div>
      )}

      {step === 'connect' && (() => {
        const connectQuery = connectSearch.trim().toLowerCase()
        const searchResults = connectQuery
          ? data.categories
              .flatMap((category) =>
                category.providers
                  .filter((p) => p.toLowerCase().includes(connectQuery))
                  .map((provider) => ({ provider, category })),
              )
              .slice(0, 12)
          : []

        const neededMissing = data.categories.filter(
          (c) =>
            NEEDED_CATEGORY_IDS.includes(c.id) &&
            enabled.includes(c.module) &&
            !c.providers.some((p) => requested.has(p)),
        )

        const requestedList = data.requested.map((name) => ({
          name,
          categoryLabel: data.categories.find((c) => c.providers.includes(name))?.name ?? 'Other',
        }))

        const providerButton = (provider: string, categoryId: string) => {
          const on = requested.has(provider)
          return (
            <ActionButton
              key={provider}
              variant={on ? 'brand' : 'outline'}
              onClick={() =>
                run(
                  () => (on ? removeProvider(provider) : requestProvider(provider, categoryId)),
                  on ? undefined : `${provider} noted`,
                )
              }
            >
              {provider}
              {supported.has(provider) ? ' *' : ''}
            </ActionButton>
          )
        }

        return (
          <div className="space-y-3">
            <input
              value={connectSearch}
              onChange={(e) => setConnectSearch(e.target.value)}
              aria-label="Search every connector"
              placeholder="Search every connector, Chase, Amex, Delta, Whoop..."
              className={cn(fieldClass, 'w-full')}
            />

            {connectQuery && (
              <Card className="space-y-2">
                <Eyebrow>Matches · {searchResults.length}</Eyebrow>
                {searchResults.length === 0 ? (
                  <p className="text-footnote text-secondary-label">
                    Nothing matches. Open the closest category below and add it manually.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {searchResults.map(({ provider, category }) =>
                      providerButton(provider, category.id),
                    )}
                  </div>
                )}
              </Card>
            )}

            {requestedList.length > 0 && (
              <Card selected className="space-y-2">
                <Eyebrow>Requested · {requestedList.length}</Eyebrow>
                <div className="flex flex-wrap gap-1.5">
                  {requestedList.map(({ name }) => (
                    <ActionButton
                      key={name}
                      variant="brand"
                      onClick={() => run(() => removeProvider(name))}
                    >
                      {name}
                    </ActionButton>
                  ))}
                </div>
              </Card>
            )}

            {data.categories.length === 0 ? (
              <EmptyState headline="Nothing to connect">
                None of the modules you kept read from an outside provider. You can still enter
                everything by hand.
              </EmptyState>
            ) : (
              data.categories.map((category) => {
                const moduleOn = enabled.includes(category.module)
                const moduleLabel = data.modules.find((m) => m.id === category.module)?.label ?? category.module
                const displayName = withAmpersand(category.name)
                const subLine = `Feeds ${moduleLabel} · ${listify(category.data)}`

                // A category whose module is off stays visible, greyed, with
                // an inline way to turn that module on, rather than
                // disappearing or opening.
                if (!moduleOn) {
                  return (
                    <Card key={category.id} className="border-dashed bg-transparent">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="text-subheadline text-secondary-label">{displayName}</span>
                        <span className="flex items-center gap-2.5">
                          <span className="label text-secondary-label">
                            {moduleLabel} module off
                          </span>
                          <ActionButton variant="outline" onClick={() => toggleModule(category.module)}>
                            Add {moduleLabel} module
                          </ActionButton>
                        </span>
                      </div>
                      <p className="mt-1 text-caption-1 text-secondary-label">{subLine}</p>
                    </Card>
                  )
                }

                const requestedCount = category.providers.filter((p) => requested.has(p)).length
                const needed = NEEDED_CATEGORY_IDS.includes(category.id) && requestedCount === 0
                const open = openCategory === category.id

                return (
                  <Card key={category.id} className="space-y-3">
                    <button
                      type="button"
                      onClick={() => {
                        setOpenCategory(open ? null : category.id)
                        setManualOpen(false)
                      }}
                      aria-expanded={open}
                      className="-mx-2 w-[calc(100%+16px)] rounded-control px-2 text-left transition-colors duration-150 hover:bg-fill-4"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="flex items-baseline gap-2">
                          <span className="text-subheadline text-label">{displayName}</span>
                          {needed && (
                            <span className="label border border-orange px-1.5 py-0.5 text-orange-text rounded-full">
                              Needed
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              'label',
                              requestedCount > 0 ? 'text-accent' : 'text-secondary-label',
                            )}
                          >
                            {requestedCount > 0
                              ? `${requestedCount} requested`
                              : `${category.providers.length} available`}
                          </span>
                          <span className="text-secondary-label">{open ? '▴' : '▾'}</span>
                        </span>
                      </div>
                      <p className="mt-1 text-caption-1 text-secondary-label">{subLine}</p>
                    </button>

                    {open && (
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-1.5">
                          {category.providers.map((provider) => providerButton(provider, category.id))}
                        </div>

                        {manualOpen ? (
                          <div className="flex flex-wrap gap-2">
                            <input
                              value={manualValue}
                              onChange={(e) => setManualValue(e.target.value)}
                              aria-label="Name of the institution"
                              placeholder="Name of the institution"
                              className={cn(fieldClass, 'flex-1')}
                            />
                            <ActionButton
                              variant="solid"
                              onClick={() => {
                                const name = manualValue.trim()
                                if (!name) return
                                run(() => requestProvider(name, category.id), `${name} noted`)
                                setManualValue('')
                                setManualOpen(false)
                              }}
                            >
                              Add
                            </ActionButton>
                          </div>
                        ) : (
                          <ActionButton variant="outline" onClick={() => setManualOpen(true)}>
                            Add manually
                          </ActionButton>
                        )}
                      </div>
                    )}
                  </Card>
                )
              })
            )}

            <p className="text-footnote text-secondary-label">
              {neededMissing.length > 0
                ? `${neededMissing.map((c) => withAmpersand(c.name)).join(' and ')} carry the numbers behind Finance and Goals. Without at least one in each, those tiles open empty.`
                : `${requested.size} requested across ${data.categories.filter((c) => c.providers.some((p) => requested.has(p))).length} categories. Add the rest any time from Settings, Connections.`}
            </p>

            <p className="text-footnote text-secondary-label">
              A star means a real integration exists and can sync it once you authorise it at
              Settings. Everything else is recorded as a request, so it is written down and nothing
              pretends to be connected.
            </p>
          </div>
        )
      })()}

      {step === 'goals' && (
        <div className="space-y-3">
          {!data.hasGoals ? (
            <EmptyState headline="No goals module">
              Goals is not installed, so there is nothing to seed. Skip this one.
            </EmptyState>
          ) : (
            <RowList>
              {STARTER_GOALS.map((g) => {
                const computable = g.wants !== null && metricIds.has(g.wants)
                const on = picked.includes(g.title)
                const setCfg = (key: 'target' | 'deadline', value: string) =>
                  setGoalCfg((prev) => ({ ...prev, [g.title]: { ...prev[g.title], [key]: value } }))
                return (
                  <Row
                    key={g.title}
                    title={g.title}
                    meta={g.blurb}
                    selected={on}
                    right={
                      <>
                        {g.wants && (
                          <Chip tone={computable ? 'brand' : 'quiet'}>
                            {computable ? 'computed' : 'by hand'}
                          </Chip>
                        )}
                        <ActionButton
                          variant={on ? 'brand' : 'outline'}
                          onClick={() =>
                            setPicked(on ? picked.filter((t) => t !== g.title) : [...picked, g.title])
                          }
                        >
                          {on ? 'Picked' : 'Add'}
                        </ActionButton>
                      </>
                    }
                  >
                    {on && (
                      <div className="mt-3.5 flex flex-wrap gap-3.5 border-t border-separator pt-3.5">
                        <label className="flex min-w-[130px] flex-1 flex-col gap-1.5">
                          <Eyebrow>Target ({g.unit})</Eyebrow>
                          <input
                            aria-label={`${g.title} target`}
                            defaultValue={String(g.target_value)}
                            onChange={(e) => setCfg('target', e.target.value)}
                            className={cn(fieldClass, 'w-full')}
                          />
                        </label>
                        <label className="flex min-w-[150px] flex-1 flex-col gap-1.5">
                          <Eyebrow>By when</Eyebrow>
                          <input
                            type="date"
                            aria-label={`${g.title} deadline`}
                            defaultValue={goalCfg[g.title]?.deadline ?? defaultDeadline}
                            onChange={(e) => setCfg('deadline', e.target.value)}
                            className={cn(fieldClass, 'w-full')}
                          />
                        </label>
                      </div>
                    )}
                  </Row>
                )
              })}
            </RowList>
          )}
          <p className="text-footnote text-secondary-label">
            {picked.length > 0
              ? `${picked.length} picked. Written when you finish, not now; anything computed updates nightly, manual goals only move when you check in.`
              : 'You can start with none, but the Goals tile stays empty until something is seeded.'}
          </p>
        </div>
      )}

      {step === 'notify' && (
        <div className="space-y-5">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,210px),1fr))] gap-3.5">
            {NOTIFY_PRESETS.map((p) => (
              <Card key={p.id} selected={selectedPreset === p.id} className="p-0">
                <button
                  type="button"
                  aria-pressed={selectedPreset === p.id}
                  onClick={() => {
                    setSelectedPreset(p.id)
                    run(async () => {
                      const results = await Promise.all([
                        saveSetting('quiet_from', p.quietFrom),
                        saveSetting('quiet_to', p.quietTo),
                        saveSetting('quiet_urgent_override', p.override),
                      ])
                      return results.find((r) => !r.ok) ?? { ok: true }
                    })
                  }}
                  className="w-full rounded-card p-4 text-left transition-colors duration-150 hover:bg-fill-4"
                >
                  <Eyebrow>{p.tag}</Eyebrow>
                  <span className="mt-3 block text-callout text-label">
                    {p.name}
                  </span>
                  <span className="mt-2 block text-footnote text-secondary-label">{p.note}</span>
                </button>
              </Card>
            ))}
          </div>

          <div className="grid gap-5 sm:grid-cols-[repeat(auto-fit,minmax(min(100%,210px),1fr))]">
          <div className="space-y-2">
            <Eyebrow>Morning digest</Eyebrow>
            <div className="flex items-center gap-2.5">
              {/* Not an input. The digest goes out when the nightly cron
                * fires, once a day, so no setting here could move it. */}
              <span
                aria-label="Morning digest time"
                title="Set by the nightly cron in vercel.json"
                className={cn(fieldClass, 'inline-flex w-36 items-center tabular-nums')}
              >
                {data.nightlyAt}
              </span>
              <Switch
                label="Morning digest on"
                checked={data.schedule.morningEnabled}
                onChange={(next) => run(() => saveSetting('digest_morning_enabled', next))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Eyebrow>Evening digest</Eyebrow>
            <div className="flex items-center gap-2.5">
              <input
                type="time"
                aria-label="Evening digest time"
                defaultValue={data.schedule.eveningAt}
                onBlur={(e) => run(() => saveSetting('digest_evening_at', e.target.value))}
                className={cn(fieldClass, 'w-36')}
              />
              <Switch
                label="Evening digest on"
                checked={data.schedule.eveningEnabled}
                onChange={(next) => run(() => saveSetting('digest_evening_enabled', next))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Eyebrow>Quiet hours</Eyebrow>
            <div className="flex flex-wrap items-center gap-2">
              <input
                key={data.schedule.quietFrom}
                type="time"
                aria-label="Quiet hours start"
                defaultValue={data.schedule.quietFrom}
                onBlur={(e) => run(() => saveSetting('quiet_from', e.target.value))}
                className={cn(fieldClass, 'w-36')}
              />
              <span className="text-footnote text-secondary-label">to</span>
              <input
                key={data.schedule.quietTo}
                type="time"
                aria-label="Quiet hours end"
                defaultValue={data.schedule.quietTo}
                onBlur={(e) => run(() => saveSetting('quiet_to', e.target.value))}
                className={cn(fieldClass, 'w-36')}
              />
            </div>
            <ActionButton
              variant={data.schedule.urgentOverride ? 'brand' : 'outline'}
              onClick={() =>
                run(() => saveSetting('quiet_urgent_override', !data.schedule.urgentOverride))
              }
            >
              {data.schedule.urgentOverride ? 'Urgent breaks through' : 'Nothing breaks through'}
            </ActionButton>
          </div>
          </div>
        </div>
      )}

      {step === 'ready' && (() => {
        const onLabels = data.modules.filter((m) => enabled.includes(m.id)).map((m) => m.label)
        const presetName = NOTIFY_PRESETS.find((p) => p.id === selectedPreset)?.name ?? 'Custom'
        const rows: { key: string; value: string; jump: StepKey }[] = [
          { key: 'Name', value: `${data.ownerName || 'not set'} · ${data.timezone}`, jump: 'you' },
          { key: 'Modules', value: `${enabled.length} on · ${onLabels.join(', ')}`, jump: 'modules' },
          {
            key: 'Connected',
            value: data.requested.length
              ? `Requested: ${data.requested.join(', ')}`
              : 'Nothing yet, the dashboard will be empty',
            jump: 'connect',
          },
          {
            key: 'Goals',
            value: picked.length
              ? STARTER_GOALS.filter((g) => picked.includes(g.title)).map((g) => g.title).join(', ')
              : 'None seeded',
            jump: 'goals',
          },
          {
            key: 'Alerts',
            value: `${presetName} · quiet ${data.schedule.quietFrom}–${data.schedule.quietTo}${data.schedule.urgentOverride ? ' with urgent override' : ''}`,
            jump: 'notify',
          },
        ]

        return (
          <div className="space-y-5">
            <div className="space-y-2 bg-grouped-2 p-4 ring-2 ring-inset ring-accent rounded-card">
              <Eyebrow>First run</Eyebrow>
              <p className="text-subheadline text-label">
                Tonight at {data.nightlyAt} the agent classifies what it finds and writes the{' '}
                {data.nightlyAt} digest. A requested connection does not sync until you authorise
                it at Settings. Everything it changes is logged in the Agent Log with one-click
                undo.
              </p>
            </div>

            <div>
              <Eyebrow>Summary</Eyebrow>
              {rows.map((row) => (
                <div
                  key={row.key}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-separator py-3"
                >
                  <span className="label w-[110px] shrink-0 text-secondary-label">
                    {row.key}
                  </span>
                  <span className="min-w-0 flex-1 text-subheadline text-label">
                    {row.value}
                  </span>
                  <ActionButton variant="quiet" onClick={() => setStep(row.jump)}>
                    Change
                  </ActionButton>
                </div>
              ))}
            </div>

            <p className="text-footnote text-secondary-label">
              Nothing here is locked in. Connections, modules and rules all live in Settings once
              you are inside.
            </p>
          </div>
        )
      })()}
    </WizardShell>
  )
}
