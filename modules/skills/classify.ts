import { db } from '@/core/db'
import { loadTree, type SkillNode } from './tree'

// Rules first, model second. See docs/ARCHITECTURE.md "Classification".
//
// This is the function the manifest hands to core as its `classifier`, so it is
// what runs on every row every module creates.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Deterministic pass. Word boundary matched so "ran" does not fire on "branch".
 * Pure, because this is the half that has to be right every time.
 */
export function matchByRules(text: string, nodes: SkillNode[]): string[] {
  const hits = new Set<string>()
  for (const node of nodes) {
    for (const keyword of node.keywords ?? []) {
      if (new RegExp(`\\b${escape(keyword)}\\b`, 'i').test(text)) {
        hits.add(node.id)
        break
      }
    }
  }
  return [...hits]
}

export async function link(
  entityRef: string,
  skillId: string,
  confidence: number,
  classifiedBy: string,
): Promise<void> {
  // The where clause is the manual override rule: a human decision is never
  // overwritten by a job.
  await db().query(
    `insert into core.skill_links (entity_ref, skill_id, confidence, classified_by)
     values ($1, $2, $3, $4)
     on conflict (entity_ref, skill_id) do update
       set confidence = excluded.confidence, classified_by = excluded.classified_by
       where core.skill_links.is_manual = false`,
    [entityRef, skillId, confidence, classifiedBy],
  )
}

/**
 * Clears the unclassified marker once a real skill is found.
 *
 * It is a parking space, not a skill, so it must not survive alongside real
 * links: it would otherwise sit in the tree forever and carry XP of its own.
 * This is what happens to every row classified while Anthropic was
 * disconnected, once the nightly batch reaches it.
 */
export async function clearUnclassified(entityRef: string): Promise<void> {
  await db().query(
    `delete from core.skill_links
      where entity_ref = $1 and skill_id = 'unclassified' and is_manual = false`,
    [entityRef],
  )
}

/**
 * Links one entity to skills, using rules only. Never throws: a note that
 * cannot be classified is still a note.
 *
 * The model half used to run here, in the write path, so creating a task
 * waited on a Haiku round trip and every re-register of unchanged text bought
 * another one. Rules are a regex over the tree and cost nothing, so they stay
 * synchronous; anything they miss parks under `unclassified` and the nightly
 * reclassify job picks it up in one batched call. See jobs/reclassify.ts.
 */
export async function classify(entityRef: string, text: string): Promise<void> {
  const nodes = await loadTree()

  const ruleHits = matchByRules(text, nodes)
  if (ruleHits.length === 0) {
    // Parked for the nightly job, which is also what the owner sees if it
    // never resolves: a skill it could not place, not a silent drop.
    await link(entityRef, 'unclassified', 0, 'unclassified')
    return
  }

  for (const skillId of ruleHits) await link(entityRef, skillId, 1, 'rule')
  await clearUnclassified(entityRef)
}
