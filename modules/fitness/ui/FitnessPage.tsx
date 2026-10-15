import Link from 'next/link'
import type { ReactNode } from 'react'
import { MetricStrip, MetricTile, PageHeader, SyncBand } from '@/components/pos'
import { getConnectionStatuses } from '@/core/integrations'
import { getSkillNames } from '@/core/modules'
import { listProposals } from '@/core/proposals'
import { syncState } from '@/core/sync'
import { spine } from '@/core/series'
import { getSettings } from '@/core/settings'
import { ownerToday } from '@/core/today'
import {
  activePlan,
  fitnessGoal,
  arrivals,
  latestMetrics,
  listExercises,
  listPlanItems,
  metricSeries,
  screenWorkouts,
  thisWeek,
  workoutSpan,
} from '../data'
import { hoursLabel, load, mass, monthDay, screenState, whenLabel } from '../units'
import { Fitness, type FitnessData } from './Fitness'
import { HIT } from '@/components/pos/button-classes'
import { SetupCard } from './SetupCard'
import { syncFitness } from './sync'

const GOAL_TONE: Record<string, string> = {
  stalled: 'text-red-text',
  at_risk: 'text-orange-text',
  on_track: 'text-green-text',
  done: 'text-green-text',
}

const GOAL_LABEL: Record<string, string> = {
  stalled: 'Stalled',
  at_risk: 'At risk',
  on_track: 'On track',
  done: 'Done',
}

/**
 * A tile's number and its unit on one 34px line box, as the artboard draws
 * them. (MetricTile's own leading-none was once lost to tailwind-merge; Card
 * fixed that on 2026-09-12, the wrapper stays for the unit and the 2px nudge.)
 */
const Num = ({ children }: { children: ReactNode }) => (
  <span className="mt-0.5 block leading-none">{children}</span>
)

/** The grey unit beside a tile's figure. */
const Unit = ({ children }: { children: string }) => (
  <span className="text-subheadline text-secondary-label">{children}</span>
)

/** The mono caption line under a tile's number. */
const Sub = ({ children }: { children: string }) => (
  <span className="num mt-2 block text-caption-1 font-normal text-secondary-label">{children}</span>
)

const NEW_GOAL = `/goals?${new URLSearchParams({
  goal: 'new',
  title: 'Workouts a week',
  area: 'Health',
  unit: 'workouts',
  metric: 'fitness.workouts_this_week',
})}`

export default async function FitnessPage() {
  const [workouts, week, metrics, exercises, plan, pending, sync, span, goal, todayIso, connections, names, apple, weightSeries, settings] =
    await Promise.all([
      screenWorkouts(),
      thisWeek('calendar'),
      latestMetrics(),
      listExercises(),
      activePlan(),
      listProposals('pending'),
      syncState('fitness'),
      workoutSpan(),
      fitnessGoal(),
      ownerToday(),
      getConnectionStatuses(),
      getSkillNames(),
      arrivals(),
      // Weight is the Trends tab's default and the one metric worth a round
      // trip before its kind is known; another first kind costs one more below.
      metricSeries('weight', 30),
      getSettings(),
    ])

  const items = plan ? await listPlanItems(plan.id) : []
  // The band's job clock is the Strava pull; `requires` names Apple Health.
  const strava = connections.strava?.status === 'connected'

  const trendKind = metrics.some((m) => m.kind === 'weight') ? 'weight' : (metrics[0]?.kind ?? null)
  const trend =
    trendKind === null
      ? null
      : { kind: trendKind, days: spine(trendKind === 'weight' ? weightSeries : await metricSeries(trendKind, 30), 30, todayIso) }

  const data: FitnessData = {
    timeZone: settings.timezone,
    workouts,
    total: span.count,
    weekWorkouts: week.length,
    weekMinutes: Math.round(week.reduce((sum, w) => sum + w.duration_s, 0) / 60),
    weekLoad: load(week.map((w) => ({ kind: w.kind, durationS: w.duration_s }))),
    metrics: metrics.map((m) => ({
      kind: m.kind,
      value: Number(m.value),
      measuredOn: m.measured_on,
    })),
    trend,
    exercises: exercises.map((e) => ({
      id: e.id,
      name: e.name,
      sets: Number(e.sets),
      muscleGroup: e.muscle_group,
      measure: e.measure,
    })),
    plan:
      plan === null
        ? null
        : {
            id: plan.id,
            name: plan.name,
            goal: plan.goal,
            daysPerWeek: plan.days_per_week,
            notes: plan.notes,
            startedOn: plan.started_on,
            items: items.map((i) => ({
              id: i.id,
              dayLabel: i.day_label,
              exercise: i.exercise,
              sets: i.sets,
              reps: i.reps,
              targetWeightG: i.target_weight_g === null ? null : Number(i.target_weight_g),
              notes: i.notes,
            })),
          },
    // Read through core rather than this module's own tables: a proposal
    // belongs to the Review inbox, and this screen only says one is waiting.
    waiting: pending
      .filter((p) => p.module === 'fitness')
      .map((p) => p.title ?? 'A suggestion is waiting'),
    skills: Object.entries(names),
  }

  // The heaviest set on file, by weight then reps, with the workout it was in.
  const heaviest = data.workouts
    .filter((w) => w.best !== null)
    .sort((a, b) => b.best!.weightG - a.best!.weightG || b.best!.reps - a.best!.reps)[0]

  const weight = data.metrics.find((m) => m.kind === 'weight')
  const state = screenState({ workouts: span.count, metrics: data.metrics.length, connected: sync.connected })

  return (
    <div className="flex min-h-full flex-col space-y-7">
      <PageHeader
        eyebrow={`Fitness / ${state === 'live' ? 'Overview' : 'Setup'}`}
        // The artboard names the source and when it last pulled, with the
        // button that pulls now, in the first band.
        status={
          <SyncBand
            provider="Strava"
            at={sync.at}
            status={sync.status}
            connected={strava}
            // Strava needs a paid subscription for API access, so it is a line
            // only when it is connected; Apple Health is the source.
            hideProvider={!strava}
            arrivals={apple}
            timeZone={settings.timezone}
            onSync={syncFitness}
          />
        }
        // The same band as the phone's one action: the pull is the thing to
        // do from a phone after a run.
        phoneAction={
          <SyncBand
            provider="Strava"
            at={sync.at}
            status={sync.status}
            connected={strava}
            hideProvider={!strava}
            timeZone={settings.timezone}
            onSync={syncFitness}
          />
        }
        // The setup state is the card alone: its own h1 is inside it.
        hideTitle={state !== 'live'}
        title="Fitness"
        lede="Workouts, what they came to, and the body metrics behind them. The coach reads the week and proposes plan changes into Review; nothing here changes the plan itself."
        actions={
          // Only once there is a span to state. A live page reached on
          // readings alone has no first year, and "0 workouts · → today" is
          // not a fact about anything.
          state === 'live' &&
          span.count > 0 && (
            <span className="num text-caption-1 text-secondary-label">
              {span.count} workouts · {span.firstYear} → today
            </span>
          )
        }
      />

      {state !== 'live' ? (
        <SetupCard
          connected={strava}
          detail={connections.strava?.lastTestDetail ?? null}
        />
      ) : (
        <>
          <MetricStrip>
            <MetricTile
              size="lg"
              label="This week"
              value={
                <>
                  <Num>
                    {data.weekWorkouts} <Unit>workouts</Unit>
                  </Num>
                  <Sub>{`${hoursLabel(data.weekMinutes)} · load ${data.weekLoad}`}</Sub>
                </>
              }
            />
            <MetricTile
              size="lg"
              label={heaviest ? `${heaviest.best!.exercise} · best set` : 'Best set'}
              value={
                heaviest ? (
                  <>
                    <Num>
                      {mass(heaviest.best!.weightG).replace(' lb', '')}{' '}
                      <Unit>{`×${heaviest.best!.reps}`}</Unit>
                    </Num>
                    <Sub>{`${whenLabel(heaviest.startedAt, todayIso, settings.timezone)} · ${heaviest.name}`}</Sub>
                  </>
                ) : (
                  <>
                    <Num>
                      <span className="text-secondary-label">--</span>
                    </Num>
                    <Sub>Nothing lifted yet</Sub>
                  </>
                )
              }
            />
            <MetricTile
              size="lg"
              label={goal ? goal.title : 'Fitness goal'}
              value={
                goal ? (
                  <>
                    <Num>
                      <span className={GOAL_TONE[goal.status] ?? ''}>{goal.current}</span>{' '}
                      <Unit>{`/ ${goal.target}`}</Unit>
                    </Num>
                    <Sub>{`${GOAL_LABEL[goal.status] ?? goal.status} · ${goal.percent}%`}</Sub>
                  </>
                ) : (
                  <>
                    <Num>
                      <span className="text-secondary-label">--</span>
                    </Num>
                    <Sub>No fitness goal</Sub>
                  </>
                )
              }
            >
              {/* Prefilled with a fitness metric so progress computes; the
                * drawer's select offers the other two. */}
              <Link href={NEW_GOAL} className={`${HIT} self-start text-footnote text-accent`}>
                New fitness goal
              </Link>
            </MetricTile>
            <MetricTile
              size="lg"
              label="Body metrics"
              value={
                weight ? (
                  <>
                    <Num>
                      {mass(weight.value).replace(' lb', '')} <Unit>lb</Unit>
                    </Num>
                    <Sub>{`Measured ${monthDay(weight.measuredOn)}`}</Sub>
                  </>
                ) : (
                  <>
                    <Num>
                      <span className="text-secondary-label">--</span>
                    </Num>
                    <Sub>No readings yet</Sub>
                  </>
                )
              }
            />
          </MetricStrip>

          <Fitness data={data} />
        </>
      )}
    </div>
  )
}
