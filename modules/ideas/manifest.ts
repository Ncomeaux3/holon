import { z } from 'zod'
import { db } from '@/core/db'
import { register } from '@/core/entities'
import { defineModule, defineTool } from '@/core/module-contract'
import { callTool } from '@/core/tools'
import { deleteIdea } from './data'
import { nightlyDigest } from './jobs/nightly-digest'
import { researchIdea } from './jobs/research'
import IdeasPage from './ui/IdeasPage'
import { IdeasTile } from './ui/Tile'

const level = z.number().int().min(1).max(3)

export default defineModule({
  id: 'ideas',
  nav: { label: 'Ideas', icon: 'lightbulb', order: 80 },
  pages: { '': IdeasPage },

  tools: {
    get_digest: defineTool({
      description: 'How many ideas are at each stage, the quick wins, and what has gone stale.',
      input: z.object({}),
      run: () => nightlyDigest(),
    }),

    write: defineTool({
      description: 'Capture an idea, or move one along.',
      input: z.object({
        id: z.uuid().optional(),
        title: z.string().min(1).max(300).optional(),
        pitch: z.string().max(2000).optional(),
        notes: z.string().max(10_000).optional(),
        stage: z.enum(['exploring', 'validated', 'building', 'killed']).optional(),
        effort: level.optional(),
        impact: level.optional(),
        killed_reason: z.string().max(1000).optional(),
        goal_ref: z.uuid().nullable().optional(),
        tags: z.array(z.string().min(1).max(40)).max(20).optional(),
      }),
      run: async (input) => {
        if (input.id) {
          const fields = Object.entries(input).filter(([key]) => key !== 'id')
          if (fields.length > 0) {
            // Every key is a literal from the zod schema above, a closed set.
            const set = fields.map(([key], i) => `${key} = $${i + 2}`).join(', ')
            await db().query(`update ideas.idea set ${set} where id = $1`, [
              input.id,
              ...fields.map(([, value]) => value),
            ])
          }

          // Starting to build is the event worth anything. Capturing and
          // killing are both free, or the board would pay better than the work.
          if (input.stage === 'building') {
            const { rows } = await db().query<{ title: string }>(
              `select title from ideas.idea where id = $1`,
              [input.id],
            )
            if (rows[0]) {
              await register({
                module: 'ideas',
                entityType: 'idea',
                entityId: input.id,
                title: rows[0].title,
                eventType: 'idea_building',
              })
            }
          }
          return { id: input.id }
        }

        if (!input.title) throw new Error('An idea needs a title')

        const { rows } = await db().query<{ id: string }>(
          `insert into ideas.idea (title, pitch, notes, stage, effort, impact, goal_ref, tags)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning id`,
          [
            input.title,
            input.pitch ?? '',
            input.notes ?? '',
            input.stage ?? 'exploring',
            input.effort ?? 2,
            input.impact ?? 2,
            input.goal_ref ?? null,
            input.tags ?? [],
          ],
        )

        await register({
          module: 'ideas',
          entityType: 'idea',
          entityId: rows[0].id,
          title: input.title,
          text: [input.pitch, input.notes, (input.tags ?? []).join(' ')].filter(Boolean).join('\n'),
          eventType: 'idea_captured',
        })

        return { id: rows[0].id }
      },
    }),

    merge: defineTool({
      description:
        'Fold one idea into another: the kept idea gains the pitch and tags, the other is killed with the reason.',
      input: z.object({ keep: z.uuid(), drop: z.uuid() }),
      run: async ({ keep, drop }) => {
        const { rows } = await db().query<{ title: string; pitch: string; tags: string[] }>(
          `select title, pitch, tags from ideas.idea where id = $1`,
          [drop],
        )
        const other = rows[0]
        if (!other) throw new Error('Nothing to merge')
        const { rows: kept } = await db().query<{ title: string }>(
          `update ideas.idea
              set pitch = case when $2 = '' then pitch else trim(pitch || ' ' || $2) end,
                  tags = (select array_agg(distinct t) from unnest(tags || $3::text[]) t)
            where id = $1 returning title`,
          [keep, other.pitch, other.tags],
        )
        await db().query(
          `update ideas.idea set stage = 'killed', stage_since = now(), killed_reason = $2 where id = $1`,
          [drop, `Merged into ${kept[0]?.title ?? 'another idea'}`],
        )
        return { keep, drop }
      },
    }),

    draft_task: defineTool({
      description:
        'Draft a validation task for an idea. The task is written as an agent would write it, so it lands in review.',
      input: z.object({ id: z.uuid() }),
      run: async ({ id }) => {
        const { rows } = await db().query<{
          title: string
          pitch: string
          notes: string
          stage: string
          goal_ref: string | null
        }>(`select title, pitch, notes, stage, goal_ref from ideas.idea where id = $1`, [id])
        const idea = rows[0]
        if (!idea) throw new Error('No such idea')

        const title =
          idea.stage === 'exploring'
            ? `Validate: ${idea.title} · 30m`
            : `Next step: ${idea.title} · 45m`
        // Through the tool registry, as an agent: that is what puts the task in
        // Tasks' review state (or the Review inbox under observe), and the
        // only way one module reaches another.
        const result = await callTool(
          'tasks',
          'write',
          {
            title,
            notes: [idea.pitch, idea.notes, `From the idea: ${idea.title}`].filter(Boolean).join('\n\n'),
            estimated_minutes: idea.stage === 'exploring' ? 30 : 45,
            goal_ref: idea.goal_ref,
          },
          { source: 'agent', agent: 'ideas', title: `Draft a task for ${idea.title}` },
        )
        const taskId =
          result.status === 'done' ? ((result.result as { id?: string }).id ?? null) : null
        await db().query(`update ideas.idea set draft_task_id = $2, draft_title = $3 where id = $1`, [
          id,
          taskId,
          title,
        ])
        return { id, task_id: taskId, proposed: result.status === 'proposed' }
      },
    }),

    delete: defineTool({
      description: 'Delete an idea and its registry row. Killing keeps it; this does not.',
      input: z.object({ id: z.uuid() }),
      run: async ({ id }) => {
        await deleteIdea(id)
        return { id }
      },
    }),

    research: defineTool({
      description:
        'Run the research rubric over an idea with web search. Spends money: a cent a search plus tokens.',
      input: z.object({
        id: z.uuid(),
        /** Quick is the default per the 2026-09-05 decision. */
        depth: z.enum(['quick', 'deep']).default('quick'),
      }),
      run: ({ id, depth }) => researchIdea(id, depth),
    }),
  },

  /**
   * Research is guarded. Nothing else is.
   *
   * An idea is a note about something that does not exist: capturing, scoring
   * and killing one spends nothing and is reversible, and a killed idea is kept
   * rather than deleted.
   *
   * Research is the exception because it spends real money on every run, a cent
   * a search plus tokens, and an agent that decided to research forty ideas one
   * night would be inside the monthly cap and still wrong. The owner pressing
   * the button is the approval; an agent asking lands in the Review inbox.
   */
  guarded: ['research', 'delete'],
  requires: [],

  metrics: {
    ideas_building: {
      label: 'Ideas being built',
      unit: 'ideas',
      get: async () => {
        const { rows } = await db().query<{ n: string }>(
          `select count(*)::text as n from ideas.idea where stage = 'building'`,
        )
        return Number(rows[0].n)
      },
    },
  },

  /** See ModuleManifest.tile: the module says how its own numbers read. */
  tile: IdeasTile,

  jobs: [{ name: 'nightly_digest', run: nightlyDigest }],
  entityHref: (t, id) => (t === 'idea' ? `/ideas?idea=${id}` : null),
  entityTypes: ['idea'],
})
