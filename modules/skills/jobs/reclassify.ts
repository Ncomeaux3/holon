import { db } from '@/core/db'
import { complete } from '@/core/llm'
import { recordError } from '@/core/log'
import { loadTree, type SkillNode } from '../tree'
import { clearUnclassified, link } from '../classify'

// The model half of classification. Rules run in the write path because they
// cost nothing; everything they miss parks under `unclassified` and lands here.
//
// Why this job exists at all: the parking marker promised a nightly batch that
// was never built, so a row rules could not place stayed parked forever. It
// also moves the only per-entity model call out of the write path, which is
// what makes a task create instantly instead of waiting on a round trip.

const CLASSIFIER_MODEL = 'claude-haiku-4-5' as const

/**
 * Entities per model call.
 *
 * The tree and the instructions are ~190 tokens and used to be resent for every
 * single entity, which was about 90% of each call's input. Twenty amortises
 * that without pushing one failed parse far enough to matter.
 */
const BATCH = 20

/** Batches per run. A ceiling on what one night can spend, not a queue depth. */
const MAX_BATCHES = 10

export type ReclassifyResult = {
  /** Rows found parked under `unclassified`. */
  parked: number
  /** Rows the model placed on a real skill. */
  classified: number
  /** Rows it looked at and could not place. They stay parked. */
  unplaced: number
  calls: number
}

type Parked = { id: string; title: string; body: string | null }

type Answer = { ref: number; skill_id: string; confidence: number }

/**
 * One call for up to BATCH entities.
 *
 * Entities are addressed by position rather than uuid: a uuid costs ~20 tokens
 * to send and another ~20 to have echoed back, per row, to carry no information
 * the index does not. One retry, then the whole batch stays parked for
 * tomorrow, which is the same outcome as never having run.
 */
async function askModel(tree: string, batch: Parked[]): Promise<Answer[] | null> {
  const items = batch
    .map((row, i) => `[${i}] ${[row.title, row.body].filter(Boolean).join(': ')}`)
    .join('\n')

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const answer = await complete({
        model: CLASSIFIER_MODEL,
        purpose: 'classification',
        module: 'skills',
        system:
          'Link each numbered item to skills from the list. Reply with JSON only: an array of ' +
          '{"ref","skill_id","confidence"} where ref is the item number, skill_id is an id from ' +
          'the list, and confidence is between 0 and 1. Omit an item entirely when nothing fits. ' +
          'Do not invent ids.',
        messages: [{ role: 'user', content: `Skills:\n${tree}\n\nItems:\n${items}` }],
        maxTokens: 1024,
      })
      const parsed = JSON.parse(answer.slice(answer.indexOf('['), answer.lastIndexOf(']') + 1))
      if (Array.isArray(parsed)) return parsed
    } catch (error) {
      // Fall through to the retry, then leave the batch parked. Recorded so a
      // parked batch has a reason on the Errors tab.
      await recordError('skills.reclassify', error)
    }
  }
  return null
}

function treeText(nodes: SkillNode[]): string {
  return nodes
    .filter((n) => n.parent)
    .map((n) => `${n.id}: ${n.name}`)
    .join('\n')
}

/**
 * Place everything parked under `unclassified`, in batches.
 *
 * Never throws: this is a nightly job, and a model that is unreachable or past
 * the spend cap must leave the rows parked rather than fail the run.
 */
export async function reclassify(): Promise<ReclassifyResult> {
  const nodes = await loadTree()
  const known = new Set(nodes.map((n) => n.id))
  const tree = treeText(nodes)

  const { rows: parked } = await db().query<Parked>(
    `select e.id, e.title, e.body
       from core.skill_links l
       join core.entities e on e.id = l.entity_ref
      where l.skill_id = 'unclassified' and l.is_manual = false
      order by e.created_at
      limit $1`,
    [BATCH * MAX_BATCHES],
  )

  const result: ReclassifyResult = {
    parked: parked.length,
    classified: 0,
    unplaced: 0,
    calls: 0,
  }

  for (let i = 0; i < parked.length; i += BATCH) {
    const batch = parked.slice(i, i + BATCH)
    const answers = await askModel(tree, batch)
    result.calls++
    // A null answer is the model being unreachable or capped, so stop rather
    // than spend another nine calls finding out again.
    if (answers === null) break

    const byRef = new Map<number, Answer[]>()
    for (const answer of answers) {
      if (!known.has(answer.skill_id)) continue
      if (!Number.isInteger(answer.ref) || answer.ref < 0 || answer.ref >= batch.length) continue
      const list = byRef.get(answer.ref) ?? []
      list.push(answer)
      byRef.set(answer.ref, list)
    }

    for (const [index, row] of batch.entries()) {
      const guesses = byRef.get(index) ?? []
      if (guesses.length === 0) {
        // Stays parked. Tomorrow is not going to produce a different answer,
        // but the owner can reassign it by hand and that is the point of the
        // marker being visible.
        result.unplaced++
        continue
      }

      for (const guess of guesses) {
        await link(
          row.id,
          guess.skill_id,
          Math.min(1, Math.max(0, guess.confidence ?? 0)),
          `model:${CLASSIFIER_MODEL}`,
        )
      }
      await clearUnclassified(row.id)
      result.classified++
    }
  }

  return result
}
