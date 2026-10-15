import { z } from 'zod'
import { db } from '@/core/db'
import { defineModule, defineTool } from '@/core/module-contract'
import SkillTreePage from './ui/SkillTreePage'
import { classify, clearUnclassified } from './classify'
import { loadTree } from './tree'
import { nightlyDigest } from './jobs/nightly-digest'
import { reclassify } from './jobs/reclassify'
import { SkillsTile } from './ui/Tile'

// The Skill Tree. It owns the tree, the XP weights and the level function, and
// it is the module that supplies core with a classifier: core/entities.ts calls
// whatever module declares one, for every row every module creates.
//
// Delete this folder and the app still runs. Entities still register, events
// still emit, nothing classifies. That is the seam working.
const skillId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_]+$/, 'Lowercase letters, digits and underscores.')

export default defineModule({
  id: 'skills',
  nav: { label: 'Skills', icon: 'sparkles', order: 20 },
  pages: { '': SkillTreePage },

  classifier: classify,
  skillNames: async () => Object.fromEntries((await loadTree()).map((n) => [n.id, n.name])),

  tools: {
    get_digest: defineTool({
      description: 'Attribute levels, character level, skills gaining fastest and skills stagnant.',
      input: z.object({}),
      run: () => nightlyDigest(),
    }),

    // The tree is skills.yaml merged with these rows. There is no node table:
    // the committed yaml stays the fork default and every edit is an override.
    write: defineTool({
      description: 'Add, rename or delete a skill. Edits sit on top of the committed tree.',
      input: z.object({
        kind: z.enum(['custom', 'rename', 'delete']),
        skillId,
        name: z.string().min(1).max(80).optional(),
        parent: z.string().max(64).optional(),
        // No default. Omitting keywords must leave the stored ones alone: the
        // settings tab renames and edits keywords through the same row, and an
        // empty array here would quietly erase the other edit.
        keywords: z.array(z.string().min(1).max(40)).max(40).optional(),
      }),
      run: async ({ kind, skillId, name, parent, keywords }) => {
        await db().query(
          `insert into skills.override (kind, skill_id, name, parent, keywords)
           values ($1, $2, $3, $4, coalesce($5::text[], '{}'))
           on conflict (kind, skill_id) do update
             set name = coalesce(excluded.name, skills.override.name),
                 parent = coalesce(excluded.parent, skills.override.parent),
                 keywords = case
                   when $5::text[] is null then skills.override.keywords
                   else excluded.keywords
                 end`,
          [kind, skillId, name ?? null, parent ?? null, keywords ?? null],
        )
        return { kind, skillId }
      },
    }),

    // Undo. Restoring one skill drops its overrides; resetting drops them all,
    // which is what returns the tree to the committed skills.yaml.
    restore: defineTool({
      description: 'Drop the overrides on one skill, or on every skill to reset to skills.yaml.',
      input: z.object({ skillId: z.string().min(1).max(64).optional() }),
      run: async ({ skillId }) => {
        const { rowCount } = skillId
          ? await db().query(`delete from skills.override where skill_id = $1`, [skillId])
          : await db().query(`delete from skills.override`)
        return { dropped: rowCount ?? 0 }
      },
    }),

    // Dragging an event onto another skill on the Skill Tree screen. Sets
    // is_manual, as link below does, and nothing overwrites it afterwards:
    // classify() only ever updates rows where is_manual = false.
    reassign: defineTool({
      description: 'Move an entity\'s skill link to a different skill, by hand.',
      input: z.object({
        entityRef: z.string().uuid(),
        fromSkillId: z.string().min(1),
        toSkillId: z.string().min(1),
      }),
      run: async ({ entityRef, fromSkillId, toSkillId }) => {
        await db().query(
          `delete from core.skill_links where entity_ref = $1 and skill_id = $2`,
          [entityRef, fromSkillId],
        )
        await db().query(
          `insert into core.skill_links (entity_ref, skill_id, confidence, classified_by, is_manual)
           values ($1, $2, 1, 'human', true)
           on conflict (entity_ref, skill_id) do update
             set confidence = 1, classified_by = 'human', is_manual = true`,
          [entityRef, toSkillId],
        )
        return { entityRef, toSkillId }
      },
    }),

    // The picker on every entity drawer. Same row a reassign writes, so the
    // same rule protects it: classify() never touches a manual row. A parked
    // marker is not a skill and does not stay beside a real one.
    link: defineTool({
      description: 'Link an entity to a skill, by hand.',
      input: z.object({ entityRef: z.string().uuid(), skillId }),
      run: async ({ entityRef, skillId }) => {
        await db().query(
          `insert into core.skill_links (entity_ref, skill_id, confidence, classified_by, is_manual)
           values ($1, $2, 1, 'human', true)
           on conflict (entity_ref, skill_id) do update
             set confidence = 1, classified_by = 'human', is_manual = true`,
          [entityRef, skillId],
        )
        await clearUnclassified(entityRef)
        return { entityRef, skillId }
      },
    }),

    unlink: defineTool({
      description: 'Remove one of an entity\'s skill links.',
      input: z.object({ entityRef: z.string().uuid(), skillId }),
      run: async ({ entityRef, skillId }) => {
        await db().query(`delete from core.skill_links where entity_ref = $1 and skill_id = $2`, [
          entityRef,
          skillId,
        ])
        return { entityRef, skillId }
      },
    }),
  },

  // Nothing here costs money or changes a policy. Editing the tree is the
  // owner's own judgement, and reassigning is what manual override means.
  guarded: [],
  requires: [],

  // reclassify before the digest: it is what turns a parked row into a real
  // skill link, and the digest counts those links.
  /** See ModuleManifest.tile: the module says how its own numbers read. */
  tile: SkillsTile,
  tileHead: (payload) => ({
    meta: `level ${typeof payload.characterLevel === 'number' ? payload.characterLevel : 0}`,
  }),

  jobs: [
    { name: 'reclassify', run: reclassify },
    { name: 'nightly_digest', run: nightlyDigest },
  ],
  // Skills are not entities: a skill is what an entity links to. Nothing here
  // registers, so there is nothing to search or embed.
  entityTypes: [],
})
