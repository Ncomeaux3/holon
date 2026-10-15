'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
import { db } from '@/core/db'
import { register } from '@/core/entities'
import { applyDecisions } from '@/core/review-registry'
import { ensureReviewReminder, ensureReviewTask, reviewClosed } from '@/core/review-schedule'
import { closeReview, noteWriter, saveAnswers, weekOf } from '@/core/reviews'
import { renderNote, type ReviewAnswers } from '@/core/reviews-shape'
import { getSetting, setSetting, type Settings } from '@/core/settings'
import { ownerToday } from '@/core/today'
import { callTool, ToolInputError } from '@/core/tools'

// Server actions are standalone POST endpoints addressed by id, so the (app)
// layout does not run for them and each one authenticates independently.

export type ActionResult = { ok: true } | { ok: false; error: string; fields?: Record<string, string> }

function failed(error: unknown): ActionResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : 'Failed',
    ...(error instanceof ToolInputError && { fields: error.fields }),
  }
}

/** Save without closing, so an interrupted review is resumable. */
export async function save(answers: ReviewAnswers): Promise<ActionResult> {
  await requireOwner()
  try {
    await saveAnswers(weekOf(await ownerToday(), await getSetting('week_start')), answers)
    revalidatePath('/weekly-review')
    return { ok: true }
  } catch (error) {
    return failed(error)
  }
}

export type CloseContext = {
  weekLabel: string
  winTitles: Record<string, string>
  missTitles: Record<string, string>
  goalLines: string[]
  pickTitles: Record<string, string>
}

export type CloseResult =
  | { ok: true; note: string; skipped: string[] }
  | { ok: false; error: string; fields?: Record<string, string> }

/**
 * Close the week.
 *
 * Four writes on separate connections, not one transaction: the module
 * decisions, the manual check-ins, the week note, and the review row. The
 * review row is written last on purpose, so a week that says it closed is one
 * whose other writes landed. Anything that did not land is named in the result
 * rather than swallowed, because a review that quietly half-applied is worse
 * than one that failed.
 *
 * No module is named here. Each one is handed back what the owner decided
 * about its own rows, so deleting a module removes its part of the close
 * rather than breaking it.
 */
export async function close(
  answers: ReviewAnswers,
  context: CloseContext,
): Promise<CloseResult> {
  await requireOwner()

  const todayIso = await ownerToday()
  const week = weekOf(todayIso, await getSetting('week_start'))
  const skipped: string[] = []

  // Carried work moves to the first day of next week, which is what carrying means.
  const next = new Date(`${week}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 7)

  const { failed: refused } = await applyDecisions({
    carry: Object.entries(answers.missActions)
      .filter(([, action]) => action === 'carry' || action === 'shrink')
      .map(([id]) => id),
    carryTo: next.toISOString().slice(0, 10),
    drop: Object.entries(answers.missActions)
      .filter(([, action]) => action === 'drop')
      .map(([id]) => id),
    values: answers.checkins,
  })
  skipped.push(...refused)

  const noteText = renderNote(answers, context)
  let noteRef: string | null = null

  try {
    const writer = await noteWriter()
    if (!writer) {
      skipped.push('No module takes notes, so the write-up is kept on the review itself.')
    } else {
      const result = await callTool(
        writer,
        'write',
        { title: `Week of ${context.weekLabel}`, body: noteText },
        { source: 'ui' },
      )

      const id = result.status === 'done' ? (result.result as { id?: string }).id : undefined
      if (id) {
        // The registry row, not the module row: note_ref points at
        // core.entities so it survives the note module being swapped out.
        const { rows } = await db().query<{ id: string }>(
          `select id from core.entities where module = $1 and entity_id = $2 limit 1`,
          [writer, id],
        )
        noteRef = rows[0]?.id ?? null
      }
    }
  } catch (error) {
    skipped.push(
      `The week note was not written: ${error instanceof Error ? error.message : 'failed'}`,
    )
  }

  try {
    await closeReview({ week, answers, priorities: answers.picks, noteRef })

    // Closing a week is real work, and the only event this table emits.
    await register({
      module: 'core',
      entityType: 'review',
      entityId: week,
      title: `Week of ${context.weekLabel}`,
      text: noteText,
      eventType: 'week_reviewed',
    })
  } catch (error) {
    return failed(error) as CloseResult
  }

  try {
    await reviewClosed(week)
  } catch (error) {
    skipped.push(`The review task or reminder was not updated: ${error instanceof Error ? error.message : 'failed'}`)
  }

  revalidatePath('/weekly-review')
  revalidatePath('/', 'layout')
  return { ok: true, note: noteText, skipped }
}

export type Schedule = Pick<Settings, 'week_start' | 'review_day' | 'review_time' | 'review_reminder' | 'review_task'>

// Checked at runtime: a server action is a public POST, and the type above is
// erased by then.
const CHECK: { [K in keyof Schedule]: (v: unknown) => boolean } = {
  week_start: (v) => v === 'monday' || v === 'sunday',
  review_day: (v) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 6,
  review_time: (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v),
  review_reminder: (v) => typeof v === 'boolean',
  review_task: (v) => typeof v === 'boolean',
}

/** One schedule setting, then the reminder and the task rewritten to match. */
export async function updateSchedule<K extends keyof Schedule>(key: K, value: Schedule[K]): Promise<ActionResult> {
  await requireOwner()
  if (!Object.hasOwn(CHECK, key) || !CHECK[key](value)) return { ok: false, error: `Not a valid ${key}` }
  try {
    await setSetting(key, value as Settings[K])
    await ensureReviewReminder()
    if (key !== 'review_time' && key !== 'review_reminder') await ensureReviewTask()
    revalidatePath('/', 'layout')
    return { ok: true }
  } catch (error) {
    return failed(error)
  }
}
