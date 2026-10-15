import { db } from '@/core/db'
import { entityHref } from '@/core/modules'
import { loadTree, type SkillNode } from './tree'
import { level } from './xp'

// Everything the Skill Tree screen needs, in two queries.
//
// ponytail: the page loads all links and all events from the last 90 days and
// slices them per skill in the browser. That is a few hundred rows for one
// person. If it ever is not, move the per-skill slices into SQL keyed on the
// selected skill and fetch on select.

export type SkillEvent = {
  entityRef: string
  skillId: string
  title: string
  eventType: string
  classifiedBy: string
  isManual: boolean
  xp: number
  occurredAt: string
  /** Where the entity that earned this opens, null once it is gone. */
  href: string | null
  weight: number
}

export type SkillStat = {
  id: string
  name: string
  parent?: string
  description?: string
  keywords: string[]
  /** XP earned by this node itself, before children roll up. */
  ownXp: number
  /** ownXp plus every descendant. What the screen shows. */
  xp: number
  level: number
  gained30d: number
  lastEventAt: string | null
  /**
   * How much of what you say you are aiming at runs through this skill.
   *
   * The sum of the link weights from live goals, rolled up like XP. A skill
   * with weight and no recent XP is the one worth knowing about, which is what
   * the digest column beside it is for.
   */
  goalWeight: number
}

export type SkillTreeData = {
  nodes: SkillNode[]
  stats: SkillStat[]
  events: SkillEvent[]
  characterLevel: number
  totalXp: number
  /**
   * When this snapshot was taken. Every "last 30 days" on the screen is
   * measured from here rather than from a clock read during render, which
   * React treats as impure because two renders would disagree.
   */
  now: number
}

const DAY = 24 * 60 * 60 * 1000

/**
 * What the owner is aiming at, by skill: the sum of weight * confidence over
 * the skill links of goals. Through core.entities rather than the goals
 * schema: this module reads no other module's tables, and a fork with no
 * Goals gets zero weights rather than a missing relation. Read by the page
 * and by the nightly digest.
 */
export async function goalWeightBySkill(): Promise<Map<string, number>> {
  const { rows } = await db().query<{ skill_id: string; weight: string }>(
    `select sl.skill_id, sum(sl.weight * sl.confidence)::text as weight
       from core.skill_links sl
       join core.entities en on en.id = sl.entity_ref
      where en.module = 'goals'
      group by sl.skill_id`,
  )
  return new Map(rows.map((r) => [r.skill_id, Number(r.weight)]))
}

export async function loadSkillTree(): Promise<SkillTreeData> {
  const nodes = await loadTree()

  const [{ rows: xpRows }, { rows: eventRows }, ownWeight] = await Promise.all([
    db().query<{ skill_id: string; xp: string; last_event_at: string | null }>(
      `select skill_id, xp::text, last_event_at::text from skills.xp`,
    ),
    db().query<{
      entity_ref: string
      skill_id: string
      title: string
      event_type: string
      classified_by: string
      is_manual: boolean
      xp: string
      occurred_at: string
      module: string | null
      entity_type: string | null
      entity_id: string | null
      weight: string
    }>(
      `select
         e.entity_ref,
         sl.skill_id,
         -- The entity's title as it is now; the snapshot only once the row is gone.
         coalesce(en.title, e.title_snapshot, 'Untitled') as title,
         e.event_type,
         sl.classified_by,
         sl.is_manual,
         (w.weight * sl.weight * sl.confidence)::text as xp,
         e.occurred_at::text,
         en.module,
         en.entity_type,
         en.entity_id,
         w.weight::text as weight
       from core.events e
       join core.skill_links sl on sl.entity_ref = e.entity_ref
       join skills.xp_weight w on w.event_type = e.event_type
       left join core.entities en on en.id = e.entity_ref
       where e.occurred_at >= now() - interval '90 days'
       order by e.occurred_at desc`,
    ),
    goalWeightBySkill(),
  ])

  const ownXp = new Map(xpRows.map((r) => [r.skill_id, Number(r.xp)]))
  const lastEvent = new Map(xpRows.map((r) => [r.skill_id, r.last_event_at]))

  const childrenOf = new Map<string, string[]>()
  for (const node of nodes) {
    if (!node.parent) continue
    childrenOf.set(node.parent, [...(childrenOf.get(node.parent) ?? []), node.id])
  }
  const rollUp = (id: string): number =>
    (ownXp.get(id) ?? 0) + (childrenOf.get(id) ?? []).reduce((sum, c) => sum + rollUp(c), 0)

  const since30d = Date.now() - 30 * DAY
  const gained = new Map<string, number>()
  for (const row of eventRows) {
    if (Date.parse(row.occurred_at) < since30d) continue
    gained.set(row.skill_id, (gained.get(row.skill_id) ?? 0) + Number(row.xp))
  }
  const gained30d = (id: string): number =>
    (gained.get(id) ?? 0) + (childrenOf.get(id) ?? []).reduce((sum, c) => sum + gained30d(c), 0)

  // Rolled up like XP is. An attribute has no links of its own, so reading
  // skills.xp directly said "last event: never" for a branch that had a whole
  // month of activity underneath it.
  const lastEventOf = (id: string): string | null =>
    [lastEvent.get(id) ?? null, ...(childrenOf.get(id) ?? []).map(lastEventOf)]
      .filter((d): d is string => d !== null)
      .sort()
      .at(-1) ?? null

  const goalWeight = (id: string): number =>
    (ownWeight.get(id) ?? 0) + (childrenOf.get(id) ?? []).reduce((sum, c) => sum + goalWeight(c), 0)

  const stats: SkillStat[] = nodes.map((node) => {
    const xp = rollUp(node.id)
    return {
      id: node.id,
      name: node.name,
      parent: node.parent,
      description: node.description,
      keywords: node.keywords ?? [],
      ownXp: ownXp.get(node.id) ?? 0,
      xp,
      level: level(xp),
      gained30d: gained30d(node.id),
      lastEventAt: lastEventOf(node.id),
      goalWeight: goalWeight(node.id),
    }
  })

  const totalXp = stats.filter((s) => !s.parent).reduce((sum, s) => sum + s.xp, 0)

  return {
    nodes,
    stats,
    events: eventRows.map((r) => ({
      entityRef: r.entity_ref,
      skillId: r.skill_id,
      title: r.title,
      eventType: r.event_type,
      classifiedBy: r.classified_by,
      isManual: r.is_manual,
      xp: Number(r.xp),
      occurredAt: r.occurred_at,
      href: r.module && r.entity_type && r.entity_id ? entityHref(r.module, r.entity_type, r.entity_id) : null,
      weight: Number(r.weight),
    })),
    characterLevel: level(totalXp),
    totalXp,
    now: Date.now(),
  }
}

/** XP to reach the next level, given the formula level = floor(sqrt(xp / 100)). */
export function xpToNext(xp: number): { next: number; needed: number } {
  const next = level(xp) + 1
  return { next, needed: Math.max(0, next * next * 100 - Math.floor(xp)) }
}
