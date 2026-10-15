'use client'

import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'
import {
  ActionButton,
  Card,
  CardHead,
  DataRow,
  DataTable,
  EmptyState,
  Eyebrow,
  LineChart,
  PillGroup,
  Row,
  RowList,
  TabBar,
  type SkillLink,
} from '@/components/pos'
import { fieldClass } from '@/components/pos/field'
import { useSearchState } from '@/components/pos/searchState'
import type { Day } from '@/core/series'
import { cn } from '@/lib/utils'
import type { WorkoutStats } from '@/integrations/health_auto_export/client'
import { WORKOUT_PAGE, clock12, distance, duration, mass, pace, shortDate, sourcesLabel } from '../units'
import { readMetricSeries, readWorkouts } from './actions'
import { ExerciseDrawer, MEASURES } from './ExerciseDrawer'
import { LogWorkoutDrawer } from './LogWorkoutDrawer'
import { PlanDrawer } from './PlanDrawer'
import { WorkoutDrawer } from './WorkoutDrawer'

// Two views over one list, plus the exercise index. The view is in the URL, so
// it survives a refresh and can be linked to.

export type FitnessData = {
  /** The owner's zone: row dates are printed in it on the server and the device alike. */
  timeZone: string
  /** Every workout on file; `workouts` is the first page of them. */
  total: number
  workouts: {
    id: string
    name: string
    detail: string
    kind: string
    source: string
    /** Skill names from the classifier's links, most confident first. The row shows the first. */
    skills: string[]
    entityRef: string | null
    links: SkillLink[]
    startedAt: string
    durationS: number
    distanceM: number
    avgHr: number | null
    setCount: number
    best: { exercise: string; weightG: number; reps: number } | null
    stats: WorkoutStats
  }[]
  weekWorkouts: number
  weekMinutes: number
  weekLoad: number
  metrics: { kind: string; value: number; measuredOn: string }[]
  /** Thirty days of the first metric on file, for the Trends tab's first paint. */
  trend: { kind: string; days: Day[] } | null
  exercises: { id: string; name: string; sets: number; muscleGroup: string; measure: string }[]
  plan: {
    id: string
    name: string
    goal: string
    daysPerWeek: number
    notes: string
    startedOn: string | null
    items: {
      id: string
      dayLabel: string
      exercise: string
      sets: number
      reps: string
      targetWeightG: number | null
      notes: string
    }[]
  } | null
  /** Coach suggestions waiting in the Review inbox, by headline. */
  waiting: string[]
  /** Every skill in the tree, id and name. From getSkillNames() on the page. */
  skills: [string, string][]
}

const right = (label: string) => (
  <span key={label} className="block text-right">
    {label}
  </span>
)

/**
 * What sits after the name: the notes, then the best set for a lift or the
 * distance and pace for anything measured in metres. Pace is a ratio of two
 * stored numbers rather than a stored one, so it can never disagree with them.
 */
function detailOf(w: FitnessData['workouts'][number]): string {
  const unit = w.kind === 'swim' ? 'yd' : 'mi'
  return [
    w.detail,
    w.best ? `${w.best.exercise} ${mass(w.best.weightG)} × ${w.best.reps}` : '',
    w.distanceM > 0 ? `${distance(w.distanceM, unit)} at ${pace(w.distanceM, w.durationS, unit)}` : '',
    w.avgHr ? `${w.avgHr} bpm` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}


/** How a body metric reads. Each kind is stored in its own unit, so each reads differently. */
function metricValue(kind: string, value: number): string {
  if (kind === 'weight') return mass(value)
  if (kind === 'sleep_minutes') return duration(value * 60)
  if (kind === 'exercise_minutes') return duration(value * 60)
  if (kind === 'walking_distance') return distance(value)
  if (kind === 'body_fat' || kind === 'blood_oxygen') return `${(value / 10).toFixed(1)}%`
  if (kind === 'vo2_max') return (value / 10).toFixed(1)
  if (kind === 'respiratory_rate') return `${(value / 10).toFixed(1)} /min`
  if (kind === 'hrv') return `${Math.round(value)} ms`
  if (kind === 'active_energy') return `${Math.round(value)} kcal`
  if (kind === 'stand_hours') return `${Math.round(value)} h`
  if (kind === 'steps' || kind === 'flights_climbed') return Math.round(value).toLocaleString('en-US')
  return `${Math.round(value)} bpm`
}

const METRIC_LABELS: Record<string, string> = {
  weight: 'Weight',
  resting_hr: 'Resting heart rate',
  hrv: 'Heart rate variability',
  sleep_minutes: 'Sleep',
  body_fat: 'Body fat',
  steps: 'Steps',
  active_energy: 'Active energy',
  exercise_minutes: 'Exercise',
  stand_hours: 'Stand hours',
  vo2_max: 'VO2 max',
  blood_oxygen: 'Blood oxygen',
  respiratory_rate: 'Respiratory rate',
  flights_climbed: 'Flights climbed',
  walking_distance: 'Walking distance',
  walking_hr_avg: 'Walking heart rate',
  heart_rate_avg: 'Average heart rate',
}

/** The labels' order, body first and the daily totals after, not the alphabet's. */
const order = (kind: string) => {
  const i = Object.keys(METRIC_LABELS).indexOf(kind)
  return i === -1 ? Number.MAX_SAFE_INTEGER : i
}

/** The metrics where a fall is the good direction. */
const DOWN_IS_GOOD = new Set(['weight', 'resting_hr', 'body_fat'])

const KIND_LABELS: Record<string, string> = {
  strength: 'Strength',
  run: 'Run',
  ride: 'Ride',
  swim: 'Swim',
  walk: 'Walk',
  other: 'Other',
}

const SOURCE_LABELS: Record<string, string> = {
  manual: 'By hand',
  agent: 'Agent',
  strava: 'Strava',
  health_auto_export: 'Apple Health',
  apple_shortcuts: 'Apple Health (Shortcut)',
  notion_import: 'Notion',
  demo: 'Demo',
}

type Filter = { kind?: string; source?: string; from?: string; to?: string; limit?: number }

/** The four filter keys the URL may carry, dropped when empty. */
const filterOf = (params: URLSearchParams): Filter =>
  Object.fromEntries(
    (['kind', 'source', 'from', 'to'] as const).map((k) => [k, params.get(k) || undefined]).filter(([, v]) => v),
  )

export function Fitness({ data }: { data: FitnessData }) {
  const { params, set: setParams } = useSearchState()
  const tab = params.get('tab') ?? 'workouts'
  const [open, setOpen] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const setTab = (next: string) => setParams({ tab: next === 'workouts' ? null : next }, { local: true })

  // The filter lives in the URL and the rows it selects come from one server
  // action, like the Trends ranges: the page renders the unfiltered list, and
  // a load that arrives with a filter already set fetches once on mount.
  // Show more raises the limit a page at a time; a filter change puts it back.
  const filter = filterOf(params)
  const filtering = Object.keys(filter).length > 0
  const [limit, setLimit] = useState(WORKOUT_PAGE)
  const [filtered, setFiltered] = useState<FitnessData['workouts'] | null>(null)
  const fetchRows = (next: Filter, rows = WORKOUT_PAGE) =>
    start(async () =>
      setFiltered(Object.keys(next).length > 0 || rows > WORKOUT_PAGE ? await readWorkouts({ ...next, limit: rows }) : null),
    )
  useEffect(() => {
    if (filtering) fetchRows(filter)
    // Once, on mount: later changes go through setFilter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const setFilter = (patch: Filter) => {
    const next = { ...filter, ...patch }
    for (const k of Object.keys(next) as (keyof Filter)[]) if (!next[k]) delete next[k]
    setParams(Object.fromEntries((['kind', 'source', 'from', 'to'] as const).map((k) => [k, next[k] ?? null])), { local: true })
    setLimit(WORKOUT_PAGE)
    fetchRows(next)
  }
  const showMore = () => {
    const next = limit + WORKOUT_PAGE
    setLimit(next)
    fetchRows(filter, next)
  }
  const rows = filtered ?? data.workouts
  const shown = rows.find((r) => r.id === open)
  const kinds = [...new Set(data.workouts.map((w) => w.kind))]
  const sources = [...new Set(data.workouts.map((w) => w.source))]

  // Trends: thirty days of the first kind come with the page; every other
  // kind and range is fetched once and kept for the tab's life.
  const [trendKind, setTrendKind] = useState(data.trend?.kind ?? '')
  const [range, setRange] = useState<'30' | '90' | '365'>('30')
  const [series, setSeries] = useState<Record<string, Day[]>>(
    data.trend ? { [`${data.trend.kind}:30`]: data.trend.days } : {},
  )
  const trendKey = `${trendKind}:${range}`
  const trend = series[trendKey]
  useEffect(() => {
    if (tab !== 'trends' || !trendKind || series[trendKey]) return
    start(async () => {
      const days = await readMetricSeries(trendKind, Number(range))
      setSeries((prev) => ({ ...prev, [trendKey]: days }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, trendKey])
  const metricKinds = [...data.metrics].sort((a, b) => order(a.kind) - order(b.kind)).map((m) => m.kind)

  const [planOpen, setPlanOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [newPlan, setNewPlan] = useState(false)
  // 'new', an exercise id, or null.
  const [exerciseOpen, setExerciseOpen] = useState<string | null>(null)
  const logButton = (
    <ActionButton variant="solid" size="sm" onClick={() => setLogOpen(true)}>
      Log workout
    </ActionButton>
  )

  return (
    <div className="space-y-5">
      <TabBar
        label="Fitness views"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'workouts', label: 'Workouts', count: data.total },
          { value: 'exercises', label: 'Exercises', count: data.exercises.length },
          { value: 'body', label: 'Body', count: data.metrics.length },
          { value: 'trends', label: 'Trends' },
          { value: 'plan', label: 'Plan', count: data.plan?.items.length ?? 0 },
        ]}
      />

      {logOpen && <LogWorkoutDrawer timeZone={data.timeZone} onClose={() => setLogOpen(false)} />}

      {tab === 'workouts' &&
        (data.workouts.length === 0 ? (
          <EmptyState headline="Nothing logged" action={logButton}>
            Workouts arrive from Apple Health through Health Auto Export, or log one by hand.
            Every workout links to a Health skill and earns XP on Skills.
          </EmptyState>
        ) : (
          <Card className="py-3.5">
            <CardHead label="Recent workouts" meta={sourcesLabel(rows)} className="mb-1" />
            {/* The filter row: two selects and two native dates, each optional. */}
            <div className={cn('mb-2 flex flex-wrap items-center gap-2', pending && 'opacity-60')}>
              <select
                aria-label="Kind"
                value={filter.kind ?? ''}
                onChange={(e) => setFilter({ kind: e.target.value })}
                className={cn(fieldClass, 'w-auto py-1.5')}
              >
                <option value="">Any kind</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k] ?? k}
                  </option>
                ))}
              </select>
              <select
                aria-label="Source"
                value={filter.source ?? ''}
                onChange={(e) => setFilter({ source: e.target.value })}
                className={cn(fieldClass, 'w-auto py-1.5')}
              >
                <option value="">Any source</option>
                {sources.map((k) => (
                  <option key={k} value={k}>
                    {SOURCE_LABELS[k] ?? k}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-caption-1 text-secondary-label">
                From
                <input
                  type="date"
                  aria-label="From"
                  value={filter.from ?? ''}
                  onChange={(e) => setFilter({ from: e.target.value })}
                  className={cn(fieldClass, 'w-auto py-1.5')}
                />
              </label>
              <label className="flex items-center gap-1.5 text-caption-1 text-secondary-label">
                To
                <input
                  type="date"
                  aria-label="To"
                  value={filter.to ?? ''}
                  onChange={(e) => setFilter({ to: e.target.value })}
                  className={cn(fieldClass, 'w-auto py-1.5')}
                />
              </label>
              {filtering && (
                <ActionButton
                  variant="quiet"
                  size="sm"
                  onClick={() => setFilter({ kind: '', source: '', from: '', to: '' })}
                >
                  Clear
                </ActionButton>
              )}
              <span className="ml-auto">{logButton}</span>
            </div>
            {rows.length === 0 ? (
              <p className="py-4 text-center text-footnote text-secondary-label">No workouts match.</p>
            ) : (
              <DataTable
                head={['Date', 'Workout', right('Time'), right('Skill')]}
                cols="72px minmax(0,1fr) auto auto"
              >
                {rows.map((w) => (
                  <DataRow
                    key={w.id}
                    className="min-h-11 py-[9px] text-footnote"
                    selected={open === w.id}
                    onClick={() => setOpen(w.id)}
                  >
                      <span className="num flex flex-col">
                        <span className="text-footnote text-secondary-label">{shortDate(w.startedAt, data.timeZone)}</span>
                        <span className="text-caption-2 text-secondary-label">{clock12(w.startedAt, data.timeZone)}</span>
                      </span>
                      <span className="min-w-0 text-label">
                        {w.name} <span className="text-footnote text-secondary-label">{detailOf(w)}</span>
                      </span>
                      <span className="num text-right text-label">{duration(w.durationS)}</span>
                      <span className="text-right text-footnote text-label">
                        {w.skills[0] ?? <span className="text-secondary-label">unlinked</span>}
                      </span>
                  </DataRow>
                ))}
              </DataTable>
            )}
            {shown && (
              <WorkoutDrawer
                workout={shown}
                kindLabel={KIND_LABELS[shown.kind] ?? shown.kind}
                sourceLabel={SOURCE_LABELS[shown.source] ?? shown.source}
                timeZone={data.timeZone}
                skills={data.skills}
                exercises={data.exercises}
                onClose={() => setOpen(null)}
              />
            )}
            {/* A full page means there may be another; a short one is the end. */}
            {rows.length >= limit && (
              <div className="mt-3 flex justify-center">
                <ActionButton size="sm" variant="quiet" onClick={showMore} disabled={pending}>
                  {pending ? 'Loading' : filtering ? 'Show more' : `Show more · ${rows.length} of ${data.total}`}
                </ActionButton>
              </div>
            )}
          </Card>
        ))}

      {tab === 'exercises' && exerciseOpen && (
        <ExerciseDrawer
          exercise={data.exercises.find((e) => e.id === exerciseOpen) ?? null}
          onClose={() => setExerciseOpen(null)}
        />
      )}

      {tab === 'exercises' &&
        (data.exercises.length === 0 ? (
          <EmptyState
            headline="No exercises yet"
            action={
              <ActionButton variant="solid" onClick={() => setExerciseOpen('new')}>
                New exercise
              </ActionButton>
            }
          >
            Add one here, or it appears the first time a set is logged against it.
          </EmptyState>
        ) : (
          <div className="space-y-2.5">
            <div className="flex justify-end">
              <ActionButton variant="solid" size="sm" onClick={() => setExerciseOpen('new')}>
                New exercise
              </ActionButton>
            </div>
            <RowList>
              {data.exercises.map((e) => (
                <Row
                  key={e.id}
                  title={e.name}
                  meta={[e.muscleGroup, MEASURES[e.measure], `${e.sets} set${e.sets === 1 ? '' : 's'} logged`]
                    .filter(Boolean)
                    .join(' · ')}
                  onClick={() => setExerciseOpen(e.id)}
                />
              ))}
            </RowList>
          </div>
        ))}

      {tab === 'body' &&
        (data.metrics.length === 0 ? (
          <EmptyState headline="No readings">
            Body metrics arrive from Apple Health, through the Health Auto Export webhook or the
            Shortcut you build once, or you can enter them by hand. One reading per metric per
            day; a second is a correction.
          </EmptyState>
        ) : (
          <RowList>
            {[...data.metrics].sort((a, b) => order(a.kind) - order(b.kind)).map((m) => (
              <Row
                key={m.kind}
                title={METRIC_LABELS[m.kind] ?? m.kind}
                meta={`measured ${m.measuredOn}`}
                right={<span className="num text-subheadline text-label">{metricValue(m.kind, m.value)}</span>}
              />
            ))}
          </RowList>
        ))}

      {tab === 'trends' &&
        (metricKinds.length === 0 ? (
          <EmptyState headline="No readings">
            A trend needs readings. They arrive from Apple Health or by hand, one per metric per
            day.
          </EmptyState>
        ) : (
          <Card className="flex min-h-[260px] flex-col">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <select
                aria-label="Metric"
                value={trendKind}
                onChange={(e) => setTrendKind(e.target.value)}
                className={cn(fieldClass, 'w-auto py-1.5')}
              >
                {metricKinds.map((k) => (
                  <option key={k} value={k}>
                    {METRIC_LABELS[k] ?? k}
                  </option>
                ))}
              </select>
              <PillGroup
                label="Range"
                value={range}
                onChange={setRange}
                options={[
                  { value: '30', label: '30 days' },
                  { value: '90', label: '90 days' },
                  { value: '365', label: '365 days' },
                ]}
              />
            </div>
            {!trend ? (
              <p className="py-8 text-center text-footnote text-secondary-label">Loading</p>
            ) : trend.some((d) => d.observed) ? (
              <LineChart
                name={METRIC_LABELS[trendKind] ?? trendKind}
                days={trend}
                format={(v) => metricValue(trendKind, v)}
                formatDelta={(v) => `${v < 0 ? '-' : '+'}${metricValue(trendKind, Math.abs(v))}`}
                downIsGood={DOWN_IS_GOOD.has(trendKind)}
              />
            ) : (
              <EmptyState headline="Nothing in range" className="border-0">
                No {(METRIC_LABELS[trendKind] ?? trendKind).toLowerCase()} reading in the last {range} days.
              </EmptyState>
            )}
          </Card>
        ))}

      {tab === 'plan' && (planOpen || newPlan) && (
        <PlanDrawer
          plan={newPlan ? null : data.plan}
          onClose={() => {
            setPlanOpen(false)
            setNewPlan(false)
          }}
        />
      )}

      {tab === 'plan' &&
        (data.plan === null ? (
          <EmptyState
            headline="No plan"
            action={
              <ActionButton variant="solid" onClick={() => setPlanOpen(true)}>
                New plan
              </ActionButton>
            }
          >
            A plan is what the coach measures a week against. Without one it says nothing about
            missed sessions, because there is no target to have missed.
          </EmptyState>
        ) : (
          <div className="space-y-4">
            <Card className="space-y-2.5">
              <CardHead
                label={data.plan.name}
                meta={
                  <>
                    {data.plan.daysPerWeek} days a week
                    <ActionButton variant="quiet" size="sm" className="ml-3" onClick={() => setPlanOpen(true)}>
                      Edit
                    </ActionButton>
                    <ActionButton variant="quiet" size="sm" className="ml-1" onClick={() => setNewPlan(true)}>
                      New plan
                    </ActionButton>
                  </>
                }
              />
              {data.plan.goal && <p className="text-footnote text-label">{data.plan.goal}</p>}
              {data.plan.startedOn && (
                <p className="text-footnote text-secondary-label">Started {data.plan.startedOn}</p>
              )}
              {data.plan.notes && (
                <p className="whitespace-pre-line border-t border-separator pt-2 text-footnote text-label">
                  {data.plan.notes}
                </p>
              )}
            </Card>

            {DAYS_OF(data.plan.items).map(([day, items]) => (
              <Card key={day} className="space-y-2.5">
                <CardHead label={day || 'Any day'} meta={`${items.length}`} />
                <RowList>
                  {items.map((i) => (
                    <Row
                      key={i.id}
                      title={i.exercise}
                      meta={i.notes}
                      right={
                        <span className="num text-footnote text-label">
                          {i.sets} x {i.reps || 'as written'}
                          {i.targetWeightG === null ? '' : ` at ${mass(i.targetWeightG)}`}
                        </span>
                      }
                    />
                  ))}
                </RowList>
              </Card>
            ))}

            <Card className="space-y-2">
              <CardHead label="The coach" meta="weekly" />
              <p className="text-footnote text-label">
                Deterministic rules over the training log, not a model: a layoff, a volume spike, a
                lift with no personal best in three sessions, a week that fell short of the plan.
                Most weeks it has nothing to say, which is the point.
              </p>
              <p className="text-footnote text-secondary-label">
                It cannot change this plan. Every suggestion lands in the Review inbox as a
                proposal and stays there until you approve it.
              </p>
              {data.waiting.length > 0 && (
                <div className="space-y-1.5 border-t border-separator pt-2">
                  <Eyebrow>Waiting in Review</Eyebrow>
                  {data.waiting.map((w) => (
                    <p key={w} className="text-footnote text-label">
                      {w}
                    </p>
                  ))}
                  <Link className="inline-flex min-h-11 items-center text-footnote text-accent" href="/review">
                    Open the Review inbox
                  </Link>
                </div>
              )}
            </Card>
          </div>
        ))}
    </div>
  )
}

/** Plan items grouped by their day label, in the order the plan lists them. */
function DAYS_OF(
  items: NonNullable<FitnessData['plan']>['items'],
): [string, NonNullable<FitnessData['plan']>['items']][] {
  const days: [string, NonNullable<FitnessData['plan']>['items']][] = []
  for (const item of items) {
    const found = days.find(([label]) => label === item.dayLabel)
    if (found) found[1].push(item)
    else days.push([item.dayLabel, [item]])
  }
  return days
}
