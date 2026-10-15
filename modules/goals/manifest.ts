import { z } from 'zod'
import { db } from '@/core/db'
import { register } from '@/core/entities'
import { listMetrics } from '@/core/metrics'
import { defineModule, defineTool } from '@/core/module-contract'
import { getModule } from '@/core/modules'
import { calendarFor } from './calendar'
import { checkIn, deleteGoal, measuredGoals, patchGoal } from './data'
import { nightlyDigest, pullMetrics } from './jobs/nightly-digest'
import GoalsPage from './ui/GoalsPage'
import { GoalsTile } from './ui/Tile'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
const kind = z.enum(['number', 'count', 'streak', 'milestone'])

function sourceLabel(metricId: string): string {
  const metric = listMetrics().find((m) => m.id === metricId)
  if (!metric) return `Computed from ${metricId}`
  return `${getModule(metric.module)?.nav.label ?? metric.module} · ${metric.label}`
}

export default defineModule({
  id: 'goals',
  nav: { label: 'Goals', icon: 'target', order: 30 },
  pages: { '': GoalsPage },

  tools: {
    get_digest: defineTool({
      description: 'How many goals are on track, at risk, stalled or done, and which need a look.',
      input: z.object({}),
      run: () => nightlyDigest(),
    }),

    write: defineTool({
      description: 'Create a goal, or update one by passing its id.',
      input: z.object({
        id: z.uuid().optional(),
        title: z.string().min(1).max(300).optional(),
        notes: z.string().max(10_000).optional(),
        area: z.string().max(80).optional(),
        kind: kind.optional(),
        unit: z.string().max(20).optional(),
        start_value: z.number().optional(),
        target_value: z.number().optional(),
        deadline: date.optional(),
        /** `<module>.<metric>` from the registry, or null for manual check-ins. */
        metric_source: z.string().max(120).nullable().optional(),
        archived: z.boolean().optional(),
      }),
      run: async (input) => {
        if (input.id) {
          const { id, ...patch } = input
          await patchGoal(id, patch)
          // No register() on an update: it emits the creation event, and a goal
          // edited twice would award its XP twice.
          return { id }
        }

        if (!input.title || input.target_value === undefined || !input.deadline) {
          throw new Error('A new goal needs a title, a target value and a deadline')
        }

        const { rows } = await db().query<{ id: string }>(
          `insert into goals.goal
             (title, notes, area, kind, unit, start_value, target_value, deadline, metric_source)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           returning id`,
          [
            input.title,
            input.notes ?? '',
            input.area ?? 'Life ops',
            input.kind ?? 'number',
            input.unit ?? '',
            input.start_value ?? 0,
            input.target_value,
            input.deadline,
            input.metric_source ?? null,
          ],
        )

        await register({
          module: 'goals',
          entityType: 'goal',
          entityId: rows[0].id,
          title: input.title,
          text: input.notes,
        })

        return { id: rows[0].id }
      },
    }),

    checkin: defineTool({
      description: 'Record where a goal stands today. A second reading on the same day corrects it.',
      input: z.object({
        goal_id: z.uuid(),
        value: z.number(),
        note: z.string().max(500).optional(),
        occurred_on: date.optional(),
      }),
      run: async (input) => {
        await checkIn({
          goalId: input.goal_id,
          value: input.value,
          note: input.note,
          occurredOn: input.occurred_on,
        })

        const { rows } = await db().query<{ title: string; reached: boolean }>(
          `select title,
                  (case when kind = 'milestone'
                        then $2 >= target_value
                        else ($2 - start_value) / nullif(target_value - start_value, 0) >= 1
                   end) as reached
             from goals.goal where id = $1`,
          [input.goal_id, input.value],
        )

        // Reaching the target is the event, and it is the largest weight in the
        // XP model. A check-in that does not reach it is worth a little on its
        // own, which is what makes a habit visible on the Skill Tree.
        if (rows[0]) {
          await register({
            module: 'goals',
            entityType: 'goal',
            entityId: input.goal_id,
            title: rows[0].title,
            eventType: rows[0].reached ? 'goal_reached' : 'goal_checkin',
          })
        }

        return { goal_id: input.goal_id, reached: rows[0]?.reached ?? false }
      },
    }),

    delete: defineTool({
      description: 'Delete a goal, its check-ins and its registry row. Its events stay.',
      input: z.object({ id: z.uuid() }),
      run: async ({ id }) => {
        await deleteGoal(id)
        return { id }
      },
    }),
  },

  // Changing a goal is changing what you are aiming at, so an agent proposes it
  // rather than doing it. A check-in is a reading, not a decision, and the
  // nightly metric pull would be unusable behind an approval.
  guarded: ['write', 'delete'],
  requires: [],
  calendar: calendarFor,

  // What Goals contributes to the Weekly Review. A goal that computes itself
  // needs no input, which is what the step says out loud.
  review: {
    // Percent, status and the sentence behind the status are this module's
    // arithmetic, not the review's. The review draws what it is handed.
    pending: async () =>
      (await measuredGoals()).map(({ row, progress, rule, movement }) => ({
        id: row.id,
        title: row.title,
        unit: row.unit,
        computed: row.metric_source !== null,
        // "Finance · liquid runway", the module and the metric it publishes;
        // the raw key only when the metric has gone from the registry.
        source: row.metric_source ? sourceLabel(row.metric_source) : 'Manual check-in',
        percent: Math.round(progress.percent),
        movement,
        status: progress.status,
        note: rule,
      })),

    apply: async ({ values }) => {
      for (const [goalId, value] of Object.entries(values)) {
        await checkIn({ goalId, value, note: 'From the weekly review.' })
      }
    },
  },

  tile: GoalsTile,
  tileHead: (payload) => {
    const n = typeof payload.atRisk === 'number' ? payload.atRisk : 0
    const s = typeof payload.stalled === 'number' ? payload.stalled : 0
    return { meta: s > 0 ? `${s} stalled` : `${n} at risk` }
  },

  jobs: [
    { name: 'pull_metrics', run: pullMetrics },
    { name: 'nightly_digest', run: nightlyDigest },
  ],
  entityHref: (t, id) => (t === 'goal' ? `/goals?goal=${id}` : null),
  entityTypes: ['goal'],
})
