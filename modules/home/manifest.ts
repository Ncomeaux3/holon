import { z } from 'zod'
import { db } from '@/core/db'
import { register } from '@/core/entities'
import { defineModule, defineTool } from '@/core/module-contract'
import { calendarFor } from './calendar'
import { listServices, ownerToday, toSchedule } from './data'
import { nightlyDigest } from './jobs/nightly-digest'
import HomePage from './ui/HomePage'
import { dueLabel, dueStatus } from './schedule'
import { HomeTile } from './ui/Tile'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

export default defineModule({
  id: 'home',
  nav: { label: 'Home & Property', icon: 'house', order: 85 },
  pages: { '': HomePage },

  tools: {
    get_digest: defineTool({
      description: 'Service due now, what the next twelve months cost, and cover running out.',
      input: z.object({}),
      run: () => nightlyDigest(),
    }),

    log_service: defineTool({
      description:
        'Record work that was done on an asset, and roll its schedule forward if it was on one.',
      input: z.object({
        asset_id: z.uuid(),
        service_id: z.uuid().optional(),
        vendor_id: z.uuid().optional(),
        what: z.string().min(1).max(300),
        done_on: date,
        cost_cents: z.number().int().min(0).nullable().optional(),
        notes: z.string().max(2000).optional(),
      }),
      run: async (input) => {
        const { rows } = await db().query<{ id: string }>(
          `insert into home.service_log
             (asset_id, service_id, vendor_id, what, done_on, cost_cents, notes)
           values ($1, $2, $3, $4, $5, $6, $7)
           returning id`,
          [
            input.asset_id,
            input.service_id ?? null,
            input.vendor_id ?? null,
            input.what,
            input.done_on,
            input.cost_cents ?? null,
            input.notes ?? '',
          ],
        )

        // Doing the job is what moves the schedule. Clearing the override at
        // the same time matters: an explicit date wins over the interval, and
        // one left behind would hold the job on a date that has passed.
        if (input.service_id) {
          await db().query(
            `update home.service
                set last_done_on = $2, due_on = null, snooze_until = null
              where id = $1`,
            [input.service_id, input.done_on],
          )
        }

        await register({
          module: 'home',
          entityType: 'service_log',
          entityId: rows[0].id,
          title: input.what,
          text: input.notes ?? '',
          eventType: 'service_logged',
        })

        return { id: rows[0].id }
      },
    }),

    schedule_service: defineTool({
      description: 'Add a recurring job to an asset, or change when the next one falls.',
      input: z.object({
        id: z.uuid().optional(),
        asset_id: z.uuid().optional(),
        title: z.string().min(1).max(200).optional(),
        vendor_id: z.uuid().nullable().optional(),
        interval_months: z.number().int().min(0).max(120).optional(),
        due_on: date.nullable().optional(),
        last_done_on: date.nullable().optional(),
        cost_estimate_cents: z.number().int().min(0).optional(),
        notes: z.string().max(2000).optional(),
        active: z.boolean().optional(),
      }),
      run: async (input) => {
        if (input.id) {
          const fields = Object.entries(input).filter(([key]) => key !== 'id')
          if (fields.length > 0) {
            // Every key is a literal from the zod schema above, a closed set.
            const set = fields.map(([key], i) => `${key} = $${i + 2}`).join(', ')
            // A new due date is the owner saying when, so it ends a snooze, as
            // logging the job and the review's carry both do.
            const unsnooze = input.due_on ? ', snooze_until = null' : ''
            await db().query(`update home.service set ${set}${unsnooze} where id = $1`, [
              input.id,
              ...fields.map(([, value]) => value),
            ])
          }
          return { id: input.id }
        }

        if (!input.asset_id || !input.title) {
          throw new Error('A new service needs an asset and a title')
        }

        const { rows } = await db().query<{ id: string }>(
          `insert into home.service
             (asset_id, title, vendor_id, interval_months, due_on, last_done_on,
              cost_estimate_cents, notes)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning id`,
          [
            input.asset_id,
            input.title,
            input.vendor_id ?? null,
            input.interval_months ?? 12,
            input.due_on ?? null,
            input.last_done_on ?? null,
            input.cost_estimate_cents ?? 0,
            input.notes ?? '',
          ],
        )
        return { id: rows[0].id }
      },
    }),

    write_asset: defineTool({
      description: 'Add an asset, or change what it is worth and what it costs to keep.',
      input: z.object({
        id: z.uuid().optional(),
        kind: z.enum(['property', 'vehicle', 'equipment']).optional(),
        name: z.string().min(1).max(200).optional(),
        subtitle: z.string().max(300).optional(),
        value_cents: z.number().int().min(0).optional(),
        annual_cost_cents: z.number().int().min(0).optional(),
        value_as_of: date.nullable().optional(),
        acquired_on: date.nullable().optional(),
        notes: z.string().max(2000).optional(),
        archived: z.boolean().optional(),
      }),
      run: async (input) => {
        if (input.id) {
          const fields = Object.entries(input).filter(([key]) => key !== 'id')
          if (fields.length > 0) {
            // Every key is a literal from the zod schema above, a closed set.
            const set = fields.map(([key], i) => `${key} = $${i + 2}`).join(', ')
            await db().query(`update home.asset set ${set} where id = $1`, [
              input.id,
              ...fields.map(([, value]) => value),
            ])
          }
          // register() only runs at creation, and the registry row is what
          // search and the Skill Tree name the asset by.
          if (input.name) {
            await db().query(
              `update core.entities set title = $2
                where module = 'home' and entity_type = 'asset' and entity_id = $1`,
              [input.id, input.name],
            )
          }
          return { id: input.id }
        }

        if (!input.kind || !input.name) throw new Error('A new asset needs a kind and a name')

        const { rows } = await db().query<{ id: string }>(
          `insert into home.asset
             (kind, name, subtitle, value_cents, annual_cost_cents, value_as_of,
              acquired_on, notes)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning id`,
          [
            input.kind,
            input.name,
            input.subtitle ?? '',
            input.value_cents ?? 0,
            input.annual_cost_cents ?? 0,
            input.value_as_of ?? null,
            input.acquired_on ?? null,
            input.notes ?? '',
          ],
        )

        await register({
          module: 'home',
          entityType: 'asset',
          entityId: rows[0].id,
          title: input.name,
          text: input.subtitle ?? '',
          eventType: 'asset_added',
        })

        return { id: rows[0].id }
      },
    }),

    write_warranty: defineTool({
      description: 'Add a warranty or a document, or change what it covers and when it ends.',
      input: z.object({
        id: z.uuid().optional(),
        asset_id: z.uuid().nullable().optional(),
        name: z.string().min(1).max(200).optional(),
        detail: z.string().max(300).optional(),
        cover: z.string().max(60).optional(),
        // Null is "does not expire", a real state for a deed, not an unknown.
        expires_on: date.nullable().optional(),
        // http and https only: it is drawn as a link, and z.url() alone takes javascript:.
        document_url: z.union([z.literal(''), z.url({ protocol: /^https?$/ })]).optional(),
      }),
      run: async (input) => {
        if (input.id) {
          const fields = Object.entries(input).filter(([key]) => key !== 'id')
          if (fields.length > 0) {
            // Every key is a literal from the zod schema above, a closed set.
            const set = fields.map(([key], i) => `${key} = $${i + 2}`).join(', ')
            await db().query(`update home.warranty set ${set} where id = $1`, [
              input.id,
              ...fields.map(([, value]) => value),
            ])
          }
          return { id: input.id }
        }

        if (!input.name) throw new Error('A new warranty needs a name')

        const { rows } = await db().query<{ id: string }>(
          `insert into home.warranty (asset_id, name, detail, cover, expires_on, document_url)
           values ($1, $2, $3, $4, $5, $6)
           returning id`,
          [
            input.asset_id ?? null,
            input.name,
            input.detail ?? '',
            input.cover ?? '',
            input.expires_on ?? null,
            input.document_url ?? '',
          ],
        )
        return { id: rows[0].id }
      },
    }),
  },

  /**
   * What an asset is worth is guarded. What was done to it is not.
   *
   * `value_cents` is the owner's own estimate and it is the number the
   * combined value on the screen is made of, so an agent revising it is a
   * claim about money and belongs in the Review inbox. Logging a service,
   * scheduling the next one and snoozing a nag are all records or reminders,
   * and putting them behind an approval would fill the inbox with rows whose
   * only answer is yes.
   */
  guarded: ['write_asset'],
  requires: [],
  calendar: calendarFor,

  metrics: {
    upkeep_next_year: {
      label: 'Estimated upkeep, next 12 months',
      unit: '$',
      get: async () => (await nightlyDigest()).yearEstimateCents / 100,
    },
    service_due: {
      label: 'Service due or overdue',
      unit: 'jobs',
      get: async () => (await nightlyDigest()).dueNow.length,
    },
  },

  /**
   * Overdue service is a real miss, and it is the kind that quietly costs
   * money, so the weekly review asks about it.
   *
   * Carrying a job moves the date it is due. Dropping one snoozes it rather
   * than deleting it: a gutter clean you decided against this week is still a
   * gutter clean, and the schedule is the only thing that will remember.
   */
  review: {
    slipped: async () => {
      const today = await ownerToday()
      const services = await listServices()
      return services
        .filter((s) => dueStatus(toSchedule(s), today) === 'overdue')
        .map((s) => ({
          id: s.id,
          title: s.title,
          meta: `${s.asset_name} / ${dueLabel(toSchedule(s), today)}`,
        }))
    },
    // What is due but not yet late. The strip on the dashboard reads this, so
    // a service booked for Thursday shows up before it becomes a miss.
    upcoming: async () => {
      const today = await ownerToday()
      const services = await listServices()
      return services
        .filter((s) => s.due_on && s.due_on >= today && dueStatus(toSchedule(s), today) !== 'overdue')
        .map((s) => ({
          id: s.id,
          title: s.title,
          meta: `${s.asset_name} / ${dueLabel(toSchedule(s), today)}`,
          at: s.due_on,
          href: `/home?asset=${s.asset_id}`,
        }))
    },

    apply: async ({ carry, carryTo, drop }) => {
      for (const id of carry) {
        await db().query(
          `update home.service set due_on = $2, snooze_until = null where id = $1`,
          [id, carryTo],
        )
      }
      for (const id of drop) {
        await db().query(
          `update home.service set snooze_until = core.today() + 30 where id = $1`,
          [id],
        )
      }
    },
  },

  /** See ModuleManifest.tile: the module says how its own numbers read. */
  tile: HomeTile,

  jobs: [{ name: 'nightly_digest', run: nightlyDigest }],
  entityHref: (t, id) => (t === 'asset' ? `/home?asset=${id}` : null),
  entityTypes: ['asset', 'service_log'],
})

