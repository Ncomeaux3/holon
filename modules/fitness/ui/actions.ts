'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
import { db } from '@/core/db'
import { ownerToday } from '@/core/today'
import { callTool, ToolInputError } from '@/core/tools'
import { spine, type Day } from '@/core/series'
import { lastWeekBest, metricSeries, screenWorkouts, type ScreenWorkout, type WorkoutFilter } from '../data'

// Server actions are standalone POST endpoints addressed by id, so the (app)
// layout does not run for them and each one authenticates independently.
//
// The plan write goes through callTool rather than straight to SQL, so the
// one implementation is shared with MCP and the coach's proposals, and the
// module's own validation runs whoever is calling.

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string; fields?: Record<string, string> }

function failed(error: unknown): ActionResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : 'Failed',
    ...(error instanceof ToolInputError && { fields: error.fields }),
  }
}

function done(id?: string): ActionResult {
  revalidatePath('/fitness')
  revalidatePath('/', 'layout')
  return { ok: true, id }
}

export type PlanInput = {
  id?: string
  name?: string
  goal?: string
  days_per_week?: number
  notes?: string
  status?: 'active' | 'archived'
  started_on?: string | null
  items?: {
    day_label: string
    exercise: string
    sets: number
    reps: string
    target_weight_g: number | null
    notes: string
  }[]
}

export async function writePlan(input: PlanInput): Promise<ActionResult> {
  await requireOwner()
  try {
    const result = await callTool('fitness', 'write_plan', input, { source: 'ui' })
    const id = (result.status === 'done' ? (result.result as { id?: string }) : null)?.id
    return done(id)
  } catch (error) {
    return failed(error)
  }
}

async function run(tool: string, input: unknown): Promise<ActionResult> {
  await requireOwner()
  try {
    const result = await callTool('fitness', tool, input, { source: 'ui' })
    return done(result.status === 'done' ? (result.result as { id?: string } | undefined)?.id : undefined)
  } catch (error) {
    return failed(error)
  }
}

export type ExerciseInput = { id?: string; name: string; muscle_group: string; measure: string }
export async function writeExercise(input: ExerciseInput) {
  return run('write_exercise', input)
}

export type WorkoutInput = {
  name: string
  kind: string
  /** The owner's wall clock, turned into an instant in their zone below, the way Calendar does it. */
  date: string
  time: string
  duration_s: number
  distance_m: number
  detail?: string
}
export async function logWorkout({ date, time, ...input }: WorkoutInput) {
  await requireOwner()
  if (!ISO_DAY.test(date) || !/^\d{2}:\d{2}$/.test(time)) return { ok: false, error: 'Date and start time are required' } as ActionResult
  const { rows } = await db().query<{ at: string }>(
    `select to_json(($1::date + $2::time) at time zone
       coalesce((select value #>> '{}' from core.settings where key = 'timezone'), 'UTC')) #>> '{}' as at`,
    [date, time],
  )
  return run('log_workout', { ...input, started_at: rows[0].at })
}

export type SetInput = { exercise: string; reps: number; weight_g: number }
export async function addSets(workoutId: string, sets: SetInput[]) {
  return run('add_sets', { workout_id: workoutId, sets })
}

/** "Copy from last week" on a plan day: the heaviest set per exercise name. */
export async function readLastWeekBest() {
  await requireOwner()
  return lastWeekBest()
}

/** The Trends tab's 90 and 365 day ranges; 30 days comes with the page. */
export async function readMetricSeries(kind: string, days: number): Promise<Day[]> {
  await requireOwner()
  const span = Math.max(1, Math.min(365, Math.round(days) || 30))
  const [rows, today] = await Promise.all([metricSeries(kind, span), ownerToday()])
  return spine(rows, span, today)
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * The Workouts tab's filter row. The URL holds the filter; this holds the
 * rows. The dates come off the URL, so a hand-edited one is dropped rather
 * than handed to Postgres as a cast that throws.
 */
export async function readWorkouts(filter: WorkoutFilter): Promise<ScreenWorkout[]> {
  await requireOwner()
  return screenWorkouts({
    kind: filter.kind,
    source: filter.source,
    from: filter.from && ISO_DAY.test(filter.from) ? filter.from : undefined,
    to: filter.to && ISO_DAY.test(filter.to) ? filter.to : undefined,
    // Show more asks for a longer list, never an unbounded one.
    limit:
      Number.isInteger(filter.limit) && filter.limit! > 0 ? Math.min(filter.limit!, 1000) : undefined,
  })
}
