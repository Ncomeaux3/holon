import { db } from './db'
import { getSkillNames } from './modules'

/** One chip on a drawer: the shape SkillPicker takes. */
export type SkillChip = {
  id: string
  name: string
  confidence: number
  by: 'manual' | 'rule' | 'model'
}

export type EntitySkills = { entityRef: string; skills: SkillChip[] }

/**
 * Every entity of one type with its skill links, by the module's own id. Core
 * owns core.skill_links, so this is the one reader: a module reads its links
 * here rather than joining the table itself. An entity with no links is still
 * present, because the picker needs its registry row to add the first one.
 */
export async function listSkillLinks(
  module: string,
  entityType: string,
): Promise<Map<string, EntitySkills>> {
  const [{ rows }, names] = await Promise.all([
    db().query<{
      entity_id: string
      entity_ref: string
      skill_id: string | null
      confidence: string | null
      by: SkillChip['by'] | null
    }>(
      `select en.entity_id, en.id as entity_ref, sl.skill_id, sl.confidence::text,
              case when sl.is_manual then 'manual'
                   when sl.classified_by = 'rule' then 'rule'
                   else 'model' end as by
         from core.entities en
         left join core.skill_links sl
           on sl.entity_ref = en.id and sl.classified_by <> 'unclassified'
        where en.module = $1 and en.entity_type = $2
        order by sl.is_manual desc nulls last, sl.confidence desc, sl.skill_id`,
      [module, entityType],
    ),
    getSkillNames(),
  ])
  const map = new Map<string, EntitySkills>()
  for (const r of rows) {
    const entry = map.get(r.entity_id) ?? { entityRef: r.entity_ref, skills: [] }
    if (r.skill_id !== null) {
      entry.skills.push({
        id: r.skill_id,
        name: names[r.skill_id] ?? r.skill_id,
        confidence: Number(r.confidence),
        by: r.by ?? 'model',
      })
    }
    map.set(r.entity_id, entry)
  }
  return map
}
