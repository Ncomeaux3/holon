import { z } from 'zod'
import { db } from '@/core/db'
import { register } from '@/core/entities'
import { defineModule, defineTool } from '@/core/module-contract'
import { calendarFor } from './calendar'
import { nightlyDigest } from './jobs/nightly-digest'
import HealthPage from './ui/HealthPage'
import { HealthTile } from './ui/Tile'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

export default defineModule({
  id: 'health',
  nav: { label: 'Health', icon: 'heart', order: 55 },
  pages: { '': HealthPage },

  tools: {
    get_digest: defineTool({
      description: 'Appointments coming up, screenings that are late, and refills to order.',
      input: z.object({}),
      run: () => nightlyDigest(),
    }),

    write_appointment: defineTool({
      description: 'Book, move or close an appointment.',
      input: z.object({
        id: z.uuid().optional(),
        what: z.string().min(1).max(300).optional(),
        starts_at: z.string().optional(),
        location: z.string().max(300).optional(),
        status: z.enum(['confirmed', 'held', 'done', 'cancelled']).optional(),
        prep: z.string().max(1000).optional(),
        notes: z.string().max(2000).optional(),
        cost_estimate_cents: z.number().int().min(0).nullable().optional(),
        provider_id: z.uuid().nullable().optional(),
      }),
      run: async (input) => {
        if (input.id) {
          const fields = Object.entries(input).filter(([key]) => key !== 'id')
          if (fields.length > 0) {
            // Every key is a literal from the zod schema above, a closed set.
            const set = fields.map(([key], i) => `${key} = $${i + 2}`).join(', ')
            await db().query(`update health.appointment set ${set} where id = $1`, [
              input.id,
              ...fields.map(([, value]) => value),
            ])
          }

          if (input.status === 'done') {
            const { rows } = await db().query<{ what: string }>(
              `select what from health.appointment where id = $1`,
              [input.id],
            )
            // Going is the work. Booking it is not, which is why only this
            // emits an event.
            if (rows[0]) {
              await register({
                module: 'health',
                entityType: 'appointment',
                entityId: input.id,
                title: rows[0].what,
                eventType: 'appointment_attended',
              })
            }
          }
          return { id: input.id }
        }

        if (!input.what || !input.starts_at) {
          throw new Error('An appointment needs a description and a time')
        }

        const { rows } = await db().query<{ id: string }>(
          `insert into health.appointment
             (what, starts_at, location, status, prep, notes, cost_estimate_cents, provider_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           returning id`,
          [
            input.what,
            input.starts_at,
            input.location ?? '',
            input.status ?? 'confirmed',
            input.prep ?? '',
            input.notes ?? '',
            input.cost_estimate_cents ?? null,
            input.provider_id ?? null,
          ],
        )

        await register({
          module: 'health',
          entityType: 'appointment',
          entityId: rows[0].id,
          title: input.what,
          text: input.prep,
        })

        return { id: rows[0].id }
      },
    }),

    write_record: defineTool({
      description:
        'File a record: a lab, a visit summary, imaging, dental, vision or an immunisation, with whatever the document carried.',
      input: z.object({
        title: z.string().min(1).max(300),
        kind: z.enum(['lab', 'visit', 'imaging', 'dental', 'vision', 'immunisation']).default('visit'),
        taken_on: date,
        summary: z.string().max(2000).default(''),
        /** Whatever the document said, as written: "LDL": "118 mg/dL". */
        fields: z.record(z.string().max(80), z.string().max(400)).default({}),
        file_path: z.string().max(400).nullable().optional(),
        appointment_id: z.uuid().nullable().optional(),
      }),
      run: async (input) => {
        const { rows } = await db().query<{ id: string }>(
          `insert into health.record (title, kind, taken_on, summary, fields, file_path, appointment_id)
           values ($1, $2, $3, $4, $5, $6, $7)
           returning id`,
          [
            input.title,
            input.kind,
            input.taken_on,
            input.summary,
            JSON.stringify(input.fields),
            input.file_path ?? null,
            input.appointment_id ?? null,
          ],
        )
        await register({
          module: 'health',
          entityType: 'record',
          entityId: rows[0].id,
          title: input.title,
          text: input.summary,
        })
        return { id: rows[0].id }
      },
    }),

    log_vital: defineTool({
      description:
        'Record a clinical reading. Body weight and resting heart rate live in Fitness, not here.',
      input: z.object({
        metric: z.enum([
          'blood_pressure',
          'ldl',
          'hdl',
          'triglycerides',
          'a1c',
          'glucose',
          'vitamin_d',
          'tsh',
        ]),
        value: z.number(),
        /** '118/74'. Blood pressure is two numbers and one of them is not the reading. */
        value_text: z.string().max(40).optional(),
        measured_at: z.string(),
        provenance: z.enum(['lab', 'device', 'manual']).default('manual'),
      }),
      run: async (input, ctx) => {
        await db().query(
          `insert into health.vital
             (metric, value, value_text, measured_at, provenance, is_manual, source)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (metric, measured_at, provenance) do update
             set value = excluded.value, value_text = excluded.value_text`,
          [
            input.metric,
            input.value,
            input.value_text ?? '',
            input.measured_at,
            input.provenance,
            ctx.source === 'ui',
            ctx.source === 'agent' ? 'agent' : 'manual',
          ],
        )
        // No register(). A reading is not work, its XP weight is zero, and the
        // skill tree has no medical node for it to classify against, so it
        // would only cost a model call to file it nowhere.
        return { metric: input.metric }
      },
    }),

    mark_medication: defineTool({
      description: 'Mark a medication taken today, or unmark it.',
      input: z.object({ id: z.uuid(), taken: z.boolean().default(true), on: date.optional() }),
      run: async ({ id, taken, on }) => {
        if (taken) {
          await db().query(
            `insert into health.medication_log (medication_id, taken_on)
             values ($1, coalesce($2::date, core.today()))
             on conflict (medication_id, taken_on) do nothing`,
            [id, on ?? null],
          )
        } else {
          await db().query(
            `delete from health.medication_log
              where medication_id = $1 and taken_on = coalesce($2::date, core.today())`,
            [id, on ?? null],
          )
        }
        return { id, taken }
      },
    }),

    complete_screening: defineTool({
      description: 'Record that a screening was done, which resets its interval.',
      input: z.object({ id: z.uuid(), done_on: date.optional() }),
      run: async ({ id, done_on }) => {
        const { rows } = await db().query<{ name: string }>(
          `update health.screening
              set last_done_on = coalesce($2::date, core.today()), snooze_until = null
            where id = $1
            returning name`,
          [id, done_on ?? null],
        )
        if (rows.length === 0) throw new Error(`No screening ${id}`)

        await register({
          module: 'health',
          entityType: 'screening',
          entityId: id,
          title: rows[0].name,
          eventType: 'screening_done',
        })

        return { id, name: rows[0].name }
      },
    }),
  },

  /**
   * Appointments are guarded; readings and marks are not.
   *
   * Booking or cancelling an appointment on someone's behalf is exactly the
   * kind of decision the Review inbox exists for. Recording a lab result,
   * ticking a pill and closing out a screening are all records of things that
   * already happened, and putting them behind an approval would mean the inbox
   * filling with rows whose only answer is yes.
   */
  guarded: ['write_appointment'],
  requires: [],
  calendar: calendarFor,

  metrics: {
    screenings_due: {
      label: 'Screenings due or overdue',
      unit: 'screenings',
      get: async () => (await nightlyDigest()).screeningsDue.length,
    },
  },

  /** See ModuleManifest.tile: the module says how its own numbers read. */
  tile: HealthTile,

  jobs: [{ name: 'nightly_digest', run: nightlyDigest }],
  entityHref: (t, id) => (t === 'appointment' ? `/health?appt=${id}` : t === 'record' ? `/health?record=${id}` : null),
  entityTypes: ['appointment', 'screening', 'record'],
})
