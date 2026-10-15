import { db } from '@/core/db'
import { getSetting } from '@/core/settings'
import { listSkillLinks, type SkillChip } from '@/core/skill-links'
import { getDigest } from '@/core/digests'
import type { WorkoutStats } from '@/integrations/health_auto_export/client'
import { WORKOUT_PAGE } from './units'

// Reads for the screen and the digest. The units and the derived numbers live
// in ./units.ts, which has no imports and can be pulled into a client.

export type WorkoutRow = {
  id: string
  name: string
  detail: string
  kind: string
  source: string
  started_at: Date
  duration_s: number
  distance_m: number
  avg_hr: number | null
  set_count: string
  best_weight_g: string | null
  best_reps: number | null
  best_exercise: string | null
  stats: WorkoutStats
}

export type WorkoutFilter = {
  kind?: string
  source?: string
  /** YYYY-MM-DD, inclusive, in the owner's day. */
  from?: string
  to?: string
  limit?: number
}

/**
 * Workouts, newest first, each with its heaviest set.
 *
 * The best set is picked in SQL with distinct on rather than by loading every
 * set into memory: a year of lifting is thousands of rows and the list only
 * ever shows one line per workout. An empty filter is the screen's default
 * list; a null parameter is a clause that does not apply.
 */
export async function listWorkouts(filter: WorkoutFilter = {}): Promise<WorkoutRow[]> {
  const { rows } = await db().query<WorkoutRow>(
    `select w.id, w.name, w.detail, w.kind, w.source, w.started_at, w.duration_s,
            w.distance_m::float8 as distance_m, w.avg_hr, w.stats,
            (select count(*)::text from fitness.set_entry s where s.workout_id = w.id)
              as set_count,
            b.weight_g::text as best_weight_g, b.reps as best_reps, b.name as best_exercise
       from fitness.workout w
       left join lateral (
         select s.weight_g, s.reps, e.name
           from fitness.set_entry s
           join fitness.exercise e on e.id = s.exercise_id
          where s.workout_id = w.id
          order by s.weight_g desc, s.reps desc
          limit 1
       ) b on true
      where ($2::text is null or w.kind = $2)
        and ($3::text is null or w.source = $3)
        -- On the owner's calendar: a 21:00 Central run is tomorrow in UTC,
        -- and the row's date is drawn in the owner's zone.
        and ($4::date is null or (w.started_at at time zone coalesce(
              (select value #>> '{}' from core.settings where key = 'timezone'), 'UTC'))::date >= $4::date)
        and ($5::date is null or (w.started_at at time zone coalesce(
              (select value #>> '{}' from core.settings where key = 'timezone'), 'UTC'))::date <= $5::date)
      order by w.started_at desc
      limit $1`,
    [filter.limit ?? WORKOUT_PAGE, filter.kind ?? null, filter.source ?? null, filter.from ?? null, filter.to ?? null],
  )
  return rows
}

export type ScreenWorkout = {
  id: string
  name: string
  detail: string
  kind: string
  source: string
  /** Skill names from the classifier's links, most confident first. The row shows the first. */
  skills: string[]
  entityRef: string | null
  links: SkillChip[]
  startedAt: string
  durationS: number
  distanceM: number
  avgHr: number | null
  setCount: number
  best: { exercise: string; weightG: number; reps: number } | null
  /** What Health Auto Export sent past the columns; `{}` from any other source. */
  stats: WorkoutStats
}

/**
 * The workout list as the screen holds it, links included. One mapping for
 * the page's first render and the filter row's refetch, so the two cannot
 * drift.
 */
export async function screenWorkouts(filter: WorkoutFilter = {}): Promise<ScreenWorkout[]> {
  const [rows, links] = await Promise.all([listWorkouts(filter), listSkillLinks('fitness', 'workout')])
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    detail: w.detail,
    kind: w.kind,
    startedAt: new Date(w.started_at).toISOString(),
    source: w.source,
    // Names through the tree module's seam; an id with no name stays an id.
    skills: (links.get(w.id)?.skills ?? []).map((s) => s.name),
    entityRef: links.get(w.id)?.entityRef ?? null,
    links: links.get(w.id)?.skills ?? [],
    durationS: w.duration_s,
    distanceM: w.distance_m,
    avgHr: w.avg_hr,
    setCount: Number(w.set_count),
    best:
      w.best_weight_g === null || w.best_reps === null
        ? null
        : { exercise: w.best_exercise ?? '', weightG: Number(w.best_weight_g), reps: w.best_reps },
    stats: w.stats,
  }))
}

/** Every set of one exercise, heaviest first. The personal best list. */
export async function bestSets(
  exerciseName: string,
  limit = 5,
): Promise<{ weight_g: string; reps: number; started_at: Date }[]> {
  const { rows } = await db().query<{ weight_g: string; reps: number; started_at: Date }>(
    `select s.weight_g::text, s.reps, w.started_at
       from fitness.set_entry s
       join fitness.exercise e on e.id = s.exercise_id
       join fitness.workout w on w.id = s.workout_id
      where e.name = $1
      order by s.weight_g desc, s.reps desc
      limit $2`,
    [exerciseName, limit],
  )
  return rows
}

type ExerciseRow = { id: string; name: string; sets: string; muscle_group: string; measure: string }

export async function listExercises(): Promise<ExerciseRow[]> {
  const { rows } = await db().query<ExerciseRow>(
    `select e.id, e.name, e.muscle_group, e.measure, count(s.id)::text as sets
       from fitness.exercise e
       left join fitness.set_entry s on s.exercise_id = e.id
      group by e.id
      order by count(s.id) desc, e.name`,
  )
  return rows
}

export async function latestMetrics(): Promise<
  { kind: string; value: string; measured_on: string }[]
> {
  const { rows } = await db().query<{ kind: string; value: string; measured_on: string }>(
    `select distinct on (kind) kind, value::text, measured_on::text
       from fitness.body_metric
      order by kind, measured_on desc`,
  )
  return rows
}

/**
 * One reading a day of one metric over the last `days` days, oldest first,
 * for spine() to put on a date axis. The unit is the kind's stored unit.
 */
export async function metricSeries(
  kind: string,
  days: number,
): Promise<{ on_date: string; cents: number }[]> {
  const { rows } = await db().query<{ on_date: string; cents: string }>(
    `select measured_on::text as on_date, value::text as cents
       from fitness.body_metric
      where kind = $1 and measured_on > core.today() - $2::int
      order by measured_on`,
    [kind, days],
  )
  return rows.map((r) => ({ on_date: r.on_date, cents: Number(r.cents) }))
}

const APPLE_ROUTES = [
  '/api/integrations/health_auto_export/webhook',
  '/api/integrations/apple_shortcuts/webhook',
]

export type Arrivals = {
  /** Newest body metric from the phone. Both automations post to one route, so the rows say which kind came. */
  readings: string | null
  /** Newest workout from the phone: the last workout, not the last post, on a rest day. */
  workouts: string | null
  /**
   * Posts refused for a bad secret (401) or a bad shape (400) since the last
   * accepted one, or in the last 7 days when none was. A 500 or 429 is the
   * server's problem, not the phone's, so it is not counted.
   */
  rejected: number
  /** The newest 200 on either phone route. */
  lastAccepted: string | null
}

/**
 * What Apple data arrived and what was refused. Readings and workouts come
 * from the rows' updated_at, which the inbound upsert moves on every push;
 * the request log has no body, so it can only say a post came, not what.
 */
export async function arrivals(): Promise<Arrivals> {
  const { rows } = await db().query<{
    readings: Date | null
    workouts: Date | null
    last_accepted: Date | null
    rejected: number
  }>(
    `with ok as (
       select max(occurred_at) as at from core.request_log
        where status = 200 and route = any($1))
     select
       (select max(updated_at) from fitness.body_metric where source = any($2)) as readings,
       (select max(updated_at) from fitness.workout where source = any($2)) as workouts,
       ok.at as last_accepted,
       (select count(*)::int from core.request_log
         where status in (400, 401) and route = any($1)
           and occurred_at > coalesce(ok.at, now() - interval '7 days')) as rejected
     from ok`,
    [APPLE_ROUTES, ['health_auto_export', 'apple_shortcuts']],
  )
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null)
  const r = rows[0]
  return {
    readings: iso(r.readings),
    workouts: iso(r.workouts),
    rejected: r.rejected,
    lastAccepted: iso(r.last_accepted),
  }
}

/**
 * Workouts in the last seven days, for the load and XP figures and the goal
 * metrics. `calendar` counts from the start of the owner's week instead, which
 * is what the screen's This week tile shows (v1.2 phase 14).
 */
export async function thisWeek(
  span: 'rolling' | 'calendar' = 'rolling',
): Promise<{ kind: string; duration_s: number; distance_m: number }[]> {
  // 0 for a Sunday week, 1 for a Monday one: how far today is past the start.
  const start = span === 'calendar' ? ((await getSetting('week_start')) === 'sunday' ? 0 : 1) : null
  const { rows } = await db().query<{ kind: string; duration_s: number; distance_m: number }>(
    `select kind, duration_s, distance_m::float8 as distance_m from fitness.workout
      where case when $1::int is null then started_at >= core.today() - 7
                 -- The owner's calendar day, as the history filters read it: a
                 -- 20:00 Central Sunday run is Monday in UTC.
                 else (started_at at time zone coalesce(
                        (select value #>> '{}' from core.settings where key = 'timezone'), 'UTC'))::date
                      >= core.today() - ((extract(dow from core.today())::int - $1::int + 7) % 7) end`,
    [start],
  )
  return rows
}

/**
 * The heaviest set per exercise in the last seven days (today and the six
 * before it), by weight then reps,
 * keyed by exercise name: what "Copy from last week" fills a plan day with.
 */
export async function lastWeekBest(): Promise<Record<string, { weightG: number; reps: number }>> {
  const { rows } = await db().query<{ name: string; weight_g: number; reps: number }>(
    `select distinct on (e.name) e.name, s.weight_g, s.reps
       from fitness.set_entry s
       join fitness.workout w on w.id = s.workout_id
       join fitness.exercise e on e.id = s.exercise_id
      where w.started_at >= core.today() - 6
      order by e.name, s.weight_g desc, s.reps desc`,
  )
  return Object.fromEntries(rows.map((r) => [r.name, { weightG: r.weight_g, reps: r.reps }]))
}

export type PlanRow = {
  id: string
  name: string
  goal: string
  days_per_week: number
  notes: string
  status: string
  started_on: string | null
}

export type PlanItemRow = {
  id: string
  plan_id: string
  day_label: string
  exercise: string
  sets: number
  reps: string
  target_weight_g: string | null
  notes: string
  position: number
}

/** The plan in force, or null when there is none. Only one is ever active. */
export async function activePlan(): Promise<PlanRow | null> {
  const { rows } = await db().query<PlanRow>(
    `select id, name, goal, days_per_week, notes, status, started_on::text
       from fitness.plan where status = 'active'
      order by started_on desc nulls last limit 1`,
  )
  return rows[0] ?? null
}

export async function listPlanItems(planId: string): Promise<PlanItemRow[]> {
  const { rows } = await db().query<PlanItemRow>(
    `select id, plan_id, day_label, exercise, sets, reps, target_weight_g::text,
            notes, position
       from fitness.plan_item where plan_id = $1 order by position`,
    [planId],
  )
  return rows
}

/**
 * Lifts with no personal best since some number of sessions ago.
 *
 * The personal best is the heaviest set ever recorded for that lift, and the
 * count is how many workouts have touched the lift since the one that set it.
 * Crude on purpose: reps are not in it, so eight at 100 does not beat five at
 * 100 here. The coach only uses it to decide whether to say anything, and a
 * subtler measure would be a stronger claim than the data supports.
 */
export async function stalledLifts(): Promise<{ exercise: string; sessions: number }[]> {
  const { rows } = await db().query<{ exercise: string; sessions: number }>(
    `with best as (
       select e.name, max(s.weight_g) as best_g
         from fitness.set_entry s
         join fitness.exercise e on e.id = s.exercise_id
        where s.weight_g > 0
        group by e.name
     ),
     pr as (
       select b.name, max(w.started_at) as pr_at
         from best b
         join fitness.exercise e on e.name = b.name
         join fitness.set_entry s on s.exercise_id = e.id and s.weight_g = b.best_g
         join fitness.workout w on w.id = s.workout_id
        group by b.name
     )
     select pr.name as exercise,
            (select count(distinct w2.id)
               from fitness.set_entry s2
               join fitness.exercise e2 on e2.id = s2.exercise_id
               join fitness.workout w2 on w2.id = s2.workout_id
              where e2.name = pr.name and w2.started_at > pr.pr_at)::int as sessions
       from pr
      order by 2 desc`,
  )
  return rows.filter((r) => r.sessions > 0)
}

/** How many workouts are on file and the year the first one happened. */
export async function workoutSpan(): Promise<{ count: number; firstYear: number | null }> {
  const { rows } = await db().query<{ count: string; first: Date | null }>(
    `select count(*)::text as count, min(started_at) as first from fitness.workout`,
  )
  return {
    count: Number(rows[0].count),
    firstYear: rows[0].first ? new Date(rows[0].first).getUTCFullYear() : null,
  }
}

export type FitnessGoal = {
  title: string
  status: string
  percent: number
  current: number
  target: number
}

/**
 * The fitness goal that most needs a look, or null.
 *
 * Through the Goals module's digest, never its schema: the same seam Health
 * reads Insurance through. Which goals count as fitness is answered by the
 * registry too, with no skill id hard coded: a goal is a fitness goal when it
 * shares a skill link with a workout. The digest lists goals worst first, so
 * the first match is the one to show. `unclassified` is not a shared skill:
 * every unmatched entity carries it, and through it a tasks goal was the
 * fitness goal once digests went live (v1.1 Phase 5).
 */
export async function fitnessGoal(): Promise<FitnessGoal | null> {
  const digest = await getDigest('goals')
  const attention = Array.isArray(digest?.attention) ? (digest.attention as FitnessGoal[]) : []
  if (attention.length === 0) return null

  // Through core's one reader, which already leaves `unclassified` out.
  const [goalLinks, workoutLinks] = await Promise.all([
    listSkillLinks('goals', 'goal'),
    listSkillLinks('fitness', 'workout'),
  ])
  const workoutSkills = new Set([...workoutLinks.values()].flatMap((e) => e.skills.map((s) => s.id)))
  const goal = attention.find((g) =>
    goalLinks.get((g as FitnessGoal & { id: string }).id)?.skills.some((s) => workoutSkills.has(s.id)),
  )
  // One decimal, the way Goals prints a value: a weight converted from grams
  // arrives as 190.99968546644905 otherwise.
  const tenth = (n: number) => Math.round(n * 10) / 10
  return goal
    ? { title: goal.title, status: goal.status, percent: goal.percent, current: tenth(goal.current), target: tenth(goal.target) }
    : null
}
