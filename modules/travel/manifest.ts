import { z } from 'zod'
import { db } from '@/core/db'
import { register } from '@/core/entities'
import { remove } from '@/core/files'
import { defineModule, defineTool } from '@/core/module-contract'
import { calendarFor } from './calendar'
import { guessKind, KINDS } from './itinerary'
import { completeFinishedTrips, nightlyDigest } from './jobs/nightly-digest'
import { summarise, type Destination } from './span'
import { moveTripSpend, tagRecentTrips, tagTripSpend } from './spend'
import TravelPage from './ui/TravelPage'
import { TravelTile } from './ui/Tile'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
const time = z.string().regex(/^\d{2}:\d{2}$/, 'Expected HH:MM')

/**
 * Swap a trip's destinations for this set and bring the trip's own columns
 * back in line with them.
 *
 * Delete and insert rather than diff: the set is small, position is the array
 * order, and a row the owner removed from the middle has no identity left to
 * match on. Cascade is not involved; nothing references a destination.
 */
async function replaceDestinations(
  tripId: string,
  destinations: {
    name: string
    lat?: number | null
    lon?: number | null
    starts_on?: string | null
    ends_on?: string | null
  }[],
): Promise<void> {
  await db().query(`delete from travel.destination where trip_id = $1`, [tripId])

  for (const [position, d] of destinations.entries()) {
    await db().query(
      `insert into travel.destination (trip_id, name, lat, lon, starts_on, ends_on, position)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [tripId, d.name, d.lat ?? null, d.lon ?? null, d.starts_on ?? null, d.ends_on ?? null, position],
    )
  }

  const rows: Destination[] = destinations.map((d) => ({
    name: d.name,
    lat: d.lat ?? null,
    lon: d.lon ?? null,
    starts_on: d.starts_on ?? null,
    ends_on: d.ends_on ?? null,
  }))
  const summary = summarise(rows)

  // An empty set leaves the trip where it was rather than blanking it: a trip
  // whose last destination was removed is still the trip the owner named, and
  // erasing its dates would drop it out of the upcoming list without being
  // asked to.
  if (rows.length === 0) return

  await db().query(
    `update travel.trip
        set destination = $2, lat = $3, lon = $4, starts_on = $5, ends_on = $6
      where id = $1`,
    [tripId, summary.destination, summary.lat, summary.lon, summary.starts_on, summary.ends_on],
  )
}

/**
 * Take items off a trip. Their files leave the bucket with them. An item that
 * came from an email (it has an external_id) is kept as `dismissed` rather
 * than deleted: the row is how the next night's read knows the email, and
 * deleting it would write the item back as pending every night for 30 days.
 */
async function dropItems(where: string, params: unknown[]): Promise<void> {
  const { rows } = await db().query<{ file_path: string | null }>(
    `select file_path from travel.itinerary_item where ${where} and file_path is not null`,
    params,
  )
  for (const r of rows) await remove({ module: 'travel', path: r.file_path! })
  await db().query(
    `update travel.itinerary_item set status = 'dismissed', file_path = null
      where ${where} and external_id is not null`,
    params,
  )
  await db().query(`delete from travel.itinerary_item where ${where} and external_id is null`, params)
}

/**
 * A file is the trip's own: one safe name directly under its id, as
 * reservationPath writes it. A prefix check alone would pass `<trip>/../x`.
 */
function ownFile(tripId: string, path: string | null | undefined): void {
  if (!path) return
  const name = path.startsWith(`${tripId}/`) ? path.slice(tripId.length + 1) : ''
  if (!/^[A-Za-z0-9._-]+$/.test(name) || /^\.+$/.test(name)) {
    throw new Error("A file has to be in the trip's own folder")
  }
}

export default defineModule({
  id: 'travel',
  nav: { label: 'Travel', icon: 'globe', order: 60 },
  pages: { '': TravelPage },

  tools: {
    get_digest: defineTool({
      description: 'The next trip, what is waiting to be accepted, and any trip over budget.',
      input: z.object({}),
      run: () => nightlyDigest(),
    }),

    write_trip: defineTool({
      description: 'Create or update a trip.',
      input: z.object({
        id: z.uuid().optional(),
        name: z.string().min(1).max(200).optional(),
        destination: z.string().max(200).optional(),
        lat: z.number().min(-90).max(90).nullable().optional(),
        lon: z.number().min(-180).max(180).nullable().optional(),
        starts_on: date.nullable().optional(),
        ends_on: date.nullable().optional(),
        budget_cents: z.number().int().min(0).optional(),
        travellers: z.number().int().min(1).max(50).optional(),
        status: z.enum(['idea', 'planned', 'booked', 'done']).optional(),
        notes: z.string().max(5000).optional(),

        // The whole set, in order, or left out entirely. Replaced rather than
        // merged: the form edits a list and sends back the list it has, and
        // there is no stable identity to merge against once a row can be
        // dragged, removed or added in the middle. Omitting the key leaves the
        // destinations alone, which is what every caller that only wants to
        // change a name or a budget does.
        destinations: z
          .array(
            z.object({
              name: z.string().min(1).max(200),
              lat: z.number().min(-90).max(90).nullable().optional(),
              lon: z.number().min(-180).max(180).nullable().optional(),
              starts_on: date.nullable().optional(),
              ends_on: date.nullable().optional(),
            }),
          )
          .max(40)
          .optional(),
      }),
      run: async ({ destinations, ...input }) => {
        let id = input.id

        if (id) {
          const fields = Object.entries(input).filter(([key]) => key !== 'id')
          if (fields.length > 0) {
            // Every key is a literal from the zod schema above, a closed set.
            const set = fields.map(([key], i) => `${key} = $${i + 2}`).join(', ')
            await db().query(`update travel.trip set ${set} where id = $1`, [
              id,
              ...fields.map(([, value]) => value),
            ])
          }
          if (destinations) await replaceDestinations(id, destinations)
          await tagTripSpend(id)
          return { id }
        }

        if (!input.name) throw new Error('A trip needs a name')

        const { rows } = await db().query<{ id: string }>(
          `insert into travel.trip
             (name, destination, lat, lon, starts_on, ends_on, budget_cents, travellers,
              status, notes)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           returning id`,
          [
            input.name,
            input.destination ?? '',
            input.lat ?? null,
            input.lon ?? null,
            input.starts_on ?? null,
            input.ends_on ?? null,
            input.budget_cents ?? 0,
            input.travellers ?? 1,
            input.status ?? 'idea',
            input.notes ?? '',
          ],
        )

        id = rows[0].id

        // After the insert, so the summary the destinations imply wins over
        // whatever destination, lat, lon or dates the same call also passed.
        if (destinations) await replaceDestinations(id, destinations)

        await register({
          module: 'travel',
          entityType: 'trip',
          entityId: id,
          title: input.name,
          text: input.destination,
        })
        await tagTripSpend(id)

        return { id }
      },
    }),

    merge_trip: defineTool({
      description:
        'Fold one trip into another. The first becomes a destination of the second and is deleted.',
      input: z.object({ id: z.uuid(), into: z.uuid() }),
      run: async ({ id, into }) => {
        if (id === into) throw new Error('A trip cannot be merged into itself')

        const { rows: found } = await db().query<{
          id: string
          destination: string
          lat: string | null
          lon: string | null
          starts_on: string | null
          ends_on: string | null
          destinations: string
        }>(
          `select t.id, t.destination, t.lat::text, t.lon::text,
                  t.starts_on::text, t.ends_on::text,
                  (select count(*)::text from travel.destination d where d.trip_id = t.id)
                    as destinations
             from travel.trip t where t.id = any($1)`,
          [[id, into]],
        )
        const from = found.find((t) => t.id === id)
        if (!from) throw new Error('No such trip')
        if (!found.some((t) => t.id === into)) throw new Error('No such trip to merge into')

        // Appended after what the target already has, so the order the owner
        // built up on each trip survives the merge.
        const { rows: end } = await db().query<{ next: string }>(
          `select coalesce(max(position) + 1, 0)::text as next
             from travel.destination where trip_id = $1`,
          [into],
        )
        const next = Number(end[0].next)

        await db().query(
          `update travel.destination set trip_id = $2, position = position + $3 where trip_id = $1`,
          [id, into, next],
        )

        // A trip written before destinations existed, or through write_trip
        // without them, carries its place on its own columns and has no row to
        // re-point. Its place would be lost otherwise.
        if (Number(from.destinations) === 0 && (from.destination !== '' || from.lat !== null)) {
          await db().query(
            `insert into travel.destination (trip_id, name, lat, lon, starts_on, ends_on, position)
             values ($1, $2, $3, $4, $5, $6, $7)`,
            [into, from.destination, from.lat, from.lon, from.starts_on, from.ends_on, next],
          )
        }

        await db().query(`update travel.itinerary_item set trip_id = $2 where trip_id = $1`, [id, into])
        await db().query(`update travel.packing_item set trip_id = $2 where trip_id = $1`, [id, into])
        await db().query(`update travel.place_visited set trip_id = $2 where trip_id = $1`, [id, into])

        // budget_line is unique on (trip_id, category). Nothing is summed, so
        // where both trips budgeted for the same category the target's figure
        // stands and the source's is dropped rather than silently doubling it.
        await db().query(
          `delete from travel.budget_line a
            where a.trip_id = $1
              and exists (select 1 from travel.budget_line b
                           where b.trip_id = $2 and b.category = a.category)`,
          [id, into],
        )
        await db().query(`update travel.budget_line set trip_id = $2 where trip_id = $1`, [id, into])

        const { listDestinations } = await import('./data')
        const summary = summarise(await listDestinations(into))
        if (summary.destination !== '') {
          await db().query(
            `update travel.trip
                set destination = $2, lat = $3, lon = $4, starts_on = $5, ends_on = $6
              where id = $1`,
            [into, summary.destination, summary.lat, summary.lon, summary.starts_on, summary.ends_on],
          )
        }

        // Its tagged spend follows it into the trip it joins.
        await moveTripSpend(id, into)
        // The entities row goes with it, or search and the skill links keep
        // answering with a trip that is not there any more.
        await db().query(
          `delete from core.entities
            where module = 'travel' and entity_type = 'trip' and entity_id = $1`,
          [id],
        )
        await db().query(`delete from travel.trip where id = $1`, [id])
        await tagTripSpend(into)

        return { id: into, merged: id }
      },
    }),

    write_item: defineTool({
      description:
        'Add or update an itinerary item. An agent parsing a booking email adds it as pending.',
      input: z.object({
        id: z.uuid().optional(),
        trip_id: z.uuid().optional(),
        kind: z.enum(KINDS).optional(),
        title: z.string().min(1).max(300).optional(),
        detail: z.string().max(1000).optional(),
        occurs_on: date.nullable().optional(),
        occurs_at: time.nullable().optional(),
        amount_cents: z.number().int().min(0).optional(),
        confirmation: z.string().max(100).optional(),
        confidence: z.number().min(0).max(1).optional(),
        // The city, when it is not the one the day's destination says.
        place: z.string().max(200).optional(),
        provider: z.string().max(200).optional(),
        // A path in the travel bucket under the trip's own prefix; the upload
        // action writes the file and passes back where it put it.
        file_path: z.string().max(500).nullable().optional(),
        // idea or confirmed as the owner sets it. An agent's new item is
        // pending whatever it sends: see below.
        status: z.enum(['idea', 'confirmed']).optional(),
        // The source's own key, so an email read twice is one item.
        external_id: z.string().max(500).optional(),
      }),
      run: async (input, ctx) => {
        if (input.id) {
          // Only the owner moves an item between idea and confirmed; an agent
          // confirming its own pending row would skip the inbox.
          const fields = Object.entries(input).filter(
            ([key]) => key !== 'id' && !(key === 'status' && ctx.source === 'agent'),
          )
          if (input.file_path) {
            const { rows } = await db().query<{ trip_id: string }>(
              `select trip_id from travel.itinerary_item where id = $1`,
              [input.id],
            )
            if (!rows[0]) throw new Error('No such itinerary item')
            ownFile(rows[0].trip_id, input.file_path)
          }
          if (fields.length > 0) {
            const set = fields.map(([key], i) => `${key} = $${i + 2}`).join(', ')
            await db().query(`update travel.itinerary_item set ${set} where id = $1`, [
              input.id,
              ...fields.map(([, value]) => value),
            ])
          }
          return { id: input.id }
        }

        if (!input.trip_id || !input.title) {
          throw new Error('A new itinerary item needs a trip and a title')
        }
        ownFile(input.trip_id, input.file_path)

        // A machine reading a confirmation email is proposing, not deciding.
        // Same shape as the Second Brain inbox, for the same reason.
        const status = ctx.source === 'agent' ? 'pending' : (input.status ?? 'confirmed')

        // On conflict nothing: the same email read on a later night is the
        // item already there, whether it was accepted, edited or is waiting.
        const { rows } = await db().query<{ id: string }>(
          `insert into travel.itinerary_item
             (trip_id, kind, title, detail, occurs_on, occurs_at, amount_cents,
              confirmation, status, confidence, source, place, provider, file_path,
              external_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           on conflict (source, external_id) do nothing
           returning id`,
          [
            input.trip_id,
            input.kind ?? guessKind(input.title),
            input.title,
            input.detail ?? '',
            input.occurs_on ?? null,
            input.occurs_at ?? null,
            input.amount_cents ?? 0,
            input.confirmation ?? '',
            status,
            input.confidence ?? null,
            ctx.source === 'agent' ? 'agent' : 'manual',
            input.place ?? '',
            input.provider ?? '',
            input.file_path ?? null,
            input.external_id ?? null,
          ],
        )

        return { id: rows[0]?.id ?? null, status, duplicate: rows.length === 0 }
      },
    }),

    accept_item: defineTool({
      description: 'Accept a parsed booking into the itinerary, or reject it.',
      input: z.object({ id: z.uuid(), accept: z.boolean().default(true) }),
      run: async ({ id, accept }, ctx) => {
        // The inbox is the owner's decision. Refused here rather than guarded,
        // because at the `act` autonomy level a guarded tool runs anyway.
        if (ctx.source === 'agent') throw new Error('Only the owner accepts or rejects a parsed booking')
        if (!accept) {
          await dropItems(`id = $1 and status = 'pending'`, [id])
          return { id, status: 'rejected' }
        }
        await db().query(
          `update travel.itinerary_item set status = 'confirmed' where id = $1 and status = 'pending'`,
          [id],
        )
        return { id, status: 'confirmed' }
      },
    }),

    write_budget_line: defineTool({
      description:
        'Set a planned amount for one category of a trip, in cents, and optionally type over its actual.',
      input: z.object({
        trip_id: z.uuid(),
        category: z.string().min(1).max(80),
        planned_cents: z.number().int().min(0).optional(),
        actual_override_cents: z.number().int().min(0).nullable().optional(),
      }),
      run: async (input) => {
        await db().query(
          `insert into travel.budget_line (trip_id, category, planned_cents, actual_override_cents, position)
           values ($1, $2, coalesce($3, 0), $4,
                   (select coalesce(max(position), 0) + 1 from travel.budget_line where trip_id = $1))
           on conflict (trip_id, category) do update
             set planned_cents = coalesce($3, travel.budget_line.planned_cents),
                 actual_override_cents = case when $5 then $4 else travel.budget_line.actual_override_cents end`,
          [
            input.trip_id,
            input.category,
            input.planned_cents ?? null,
            input.actual_override_cents ?? null,
            input.actual_override_cents !== undefined,
          ],
        )
        return { trip_id: input.trip_id, category: input.category }
      },
    }),

    delete_budget_line: defineTool({
      description: 'Remove one category from a trip budget.',
      input: z.object({ trip_id: z.uuid(), category: z.string().min(1).max(80) }),
      run: async ({ trip_id, category }) => {
        await db().query(`delete from travel.budget_line where trip_id = $1 and category = $2`, [
          trip_id,
          category,
        ])
        return { trip_id, category }
      },
    }),

    write_packing: defineTool({
      description: 'Add a packing item, tick it, or remove it.',
      input: z.object({
        trip_id: z.uuid().optional(),
        id: z.uuid().optional(),
        label: z.string().min(1).max(200).optional(),
        packed: z.boolean().optional(),
        remove: z.boolean().optional(),
      }),
      run: async (input) => {
        if (input.id && input.remove) {
          await db().query(`delete from travel.packing_item where id = $1`, [input.id])
          return { id: input.id, removed: true }
        }
        if (input.id) {
          await db().query(
            `update travel.packing_item
                set packed = coalesce($2, packed), label = coalesce($3, label)
              where id = $1`,
            [input.id, input.packed ?? null, input.label ?? null],
          )
          return { id: input.id }
        }
        if (!input.trip_id || !input.label) throw new Error('A new item needs a trip and a label')
        const { rows } = await db().query<{ id: string }>(
          `insert into travel.packing_item (trip_id, label, packed, position)
           values ($1, $2, coalesce($3, false),
                   (select coalesce(max(position), 0) + 1 from travel.packing_item where trip_id = $1))
           returning id`,
          [input.trip_id, input.label, input.packed ?? false],
        )
        return { id: rows[0].id }
      },
    }),

    delete_item: defineTool({
      description: 'Remove an itinerary item.',
      input: z.object({ id: z.uuid() }),
      run: async ({ id }) => {
        await dropItems(`id = $1`, [id])
        return { id }
      },
    }),

    delete_trip: defineTool({
      description: 'Delete a trip and everything under it.',
      input: z.object({ id: z.uuid() }),
      run: async ({ id }) => {
        // Its tagged spend is freed for the rule first; then the registry row
        // goes with it, as merge_trip's does.
        await moveTripSpend(id, null)
        await db().query(`delete from core.entities where module = 'travel' and entity_type = 'trip' and entity_id = $1`, [id])
        // Its files first; the rows go with the trip by cascade.
        const { rows } = await db().query<{ file_path: string }>(
          `select file_path from travel.itinerary_item where trip_id = $1 and file_path is not null`,
          [id],
        )
        for (const r of rows) await remove({ module: 'travel', path: r.file_path })
        await db().query(`delete from travel.trip where id = $1`, [id])
        return { id }
      },
    }),

    set_loyalty: defineTool({
      description:
        'Record a loyalty balance. Typed by the owner: no loyalty site is scraped, per SPEC.',
      input: z.object({
        name: z.string().min(1).max(120),
        kind: z.enum(['airline', 'hotel', 'card', 'rail']).default('airline'),
        balance: z.number().int().min(0),
        status_tier: z.string().max(60).optional(),
      }),
      run: async (input) => {
        await db().query(
          `insert into travel.loyalty_program (name, kind, balance, status_tier)
           values ($1, $2, $3, $4)
           on conflict (name) do update
             set previous_balance = travel.loyalty_program.balance,
                 balance = excluded.balance, kind = excluded.kind,
                 status_tier = excluded.status_tier`,
          [input.name, input.kind, input.balance, input.status_tier ?? ''],
        )
        return { name: input.name, balance: input.balance }
      },
    }),

    link_loyalty_account: defineTool({
      description:
        'Name the Finance account (the card) that earns a loyalty program, or null to unlink. The balance stays typed by hand.',
      input: z.object({ id: z.uuid(), account_ref: z.uuid().nullable() }),
      run: async ({ id, account_ref }) => {
        if (account_ref !== null) {
          const { rows } = await db().query(
            `select 1 from core.entities where id = $1 and module = 'finance' and entity_type = 'account'`,
            [account_ref],
          )
          if (rows.length === 0) throw new Error(`No account ${account_ref}`)
        }
        const { rowCount } = await db().query(
          `update travel.loyalty_program set account_ref = $2 where id = $1`,
          [id, account_ref],
        )
        if (!rowCount) throw new Error(`No loyalty program ${id}`)
        return { id, account_ref }
      },
    }),
  },

  /**
   * A trip is a commitment with a budget attached, so an agent proposes one.
   *
   * `write_item` is not guarded: an agent-added item is already `pending` and
   * waits in the inbox, which is this module's own version of the same gate.
   * `accept_item` is the owner acting on that, and `set_loyalty` is a number
   * they typed.
   */
  guarded: ['write_trip', 'delete_trip', 'merge_trip'],
  requires: [],
  calendar: calendarFor,

  metrics: {
    places_visited: {
      label: 'Places visited',
      unit: 'places',
      get: async () => {
        const { rows } = await db().query<{ n: string }>(
          `select count(*)::text as n from travel.place_visited`,
        )
        return Number(rows[0].n)
      },
    },
    countries_visited: {
      label: 'Countries visited',
      unit: 'countries',
      get: async () => {
        const { rows } = await db().query<{ n: string }>(
          `select count(distinct country)::text as n from travel.place_visited
            where country <> ''`,
        )
        return Number(rows[0].n)
      },
    },
  },

  // Trips, dated by the day they start.
  review: {
    upcoming: async () => {
      const { rows } = await db().query<{
        id: string
        name: string
        destination: string
        starts_on: string
      }>(
        `select id, name, destination, starts_on::text
           from travel.trip
          where starts_on is not null and starts_on >= core.today()
          order by starts_on
          limit 8`,
      )

      return rows.map((r) => ({
        id: r.id,
        title: `${r.name} begins`,
        meta: r.destination || 'No destination yet',
        at: r.starts_on,
        href: `/travel?trip=${r.id}`,
      }))
    },
  },

  /** See ModuleManifest.tile: the module says how its own numbers read. */
  tile: TravelTile,

  jobs: [
    { name: 'complete_trips', run: completeFinishedTrips },
    { name: 'tag_spend', run: tagRecentTrips },
    { name: 'nightly_digest', run: nightlyDigest },
  ],
  entityHref: (t, id) => (t === 'trip' ? `/travel?trip=${id}` : null),
  entityTypes: ['trip'],
})
