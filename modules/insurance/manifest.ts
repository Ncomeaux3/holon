import { z } from 'zod'
import { db } from '@/core/db'
import { encrypt } from '@/core/crypto'
import { register } from '@/core/entities'
import { defineModule, defineTool } from '@/core/module-contract'
import { calendarFor } from './calendar'
import { nightlyDigest, remind } from './jobs/nightly-digest'
import InsurancePage from './ui/InsurancePage'
import { annualCents, type Cadence } from './premium'
import { postPremium, unpostPremium } from './post'
import { attachDocument, deletePolicy, listPolicies } from './data'
import { InsuranceTile } from './ui/Tile'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

/**
 * Columns write_policy may set.
 *
 * A TypeScript signature is erased at runtime, so the whitelist has to exist as
 * a value: without it, a key from the parsed input goes straight into the SET
 * clause of a statement reachable from a public server action.
 */
const PATCHABLE = [
  'kind',
  'name',
  'carrier',
  'expires_on',
  'premium_cents',
  'cadence',
  'deductible_cents',
  'limits',
  'agent_name',
  'agent_contact',
  'reminder_leads',
  'post_to_finance',
  'status',
  'notes',
] as const

/**
 * A file can only be attached from under its own policy's prefix, and the path
 * cannot traverse. Without this an agent could attach any object in the bucket
 * to a policy, read it through the signed URL, and delete it with the policy.
 */
export const ATTACH_INPUT = z
  .object({
    policy_id: z.uuid(),
    name: z.string().min(1).max(200),
    meta: z.string().max(200).default(''),
    file_path: z.string().min(1).max(500),
  })
  .refine(
    ({ policy_id, file_path }) =>
      file_path.startsWith(`${policy_id}/`) &&
      !file_path.includes('..') &&
      /^[A-Za-z0-9._-]+$/.test(file_path.slice(policy_id.length + 1)),
    { message: 'file_path must be a file directly under the policy id' },
  )

export default defineModule({
  id: 'insurance',
  nav: { label: 'Insurance', icon: 'shield', order: 90 },
  pages: { '': InsurancePage },

  tools: {
    get_digest: defineTool({
      description: 'Policies expiring inside sixty days, and what a year of cover costs.',
      input: z.object({}),
      run: () => nightlyDigest(),
    }),

    write_policy: defineTool({
      description: 'Add a policy, or change what is on file for one.',
      input: z.object({
        id: z.uuid().optional(),
        kind: z
          .enum([
            'auto', 'renters', 'homeowners', 'health', 'dental', 'vision', 'life',
            'pet', 'device', 'umbrella', 'other',
          ])
          .optional(),
        name: z.string().min(1).max(200).optional(),
        carrier: z.string().max(200).optional(),
        /** Stored encrypted. Never returned by any read except reveal. */
        policy_number: z.string().max(120).optional(),
        expires_on: date.nullable().optional(),
        premium_cents: z.number().int().min(0).optional(),
        cadence: z.enum(['monthly', 'quarterly', 'semiannual', 'annual']).optional(),
        deductible_cents: z.number().int().min(0).nullable().optional(),
        limits: z.string().max(500).optional(),
        agent_name: z.string().max(200).optional(),
        agent_contact: z.string().max(300).optional(),
        reminder_leads: z.array(z.number().int().min(0).max(365)).max(6).optional(),
        post_to_finance: z.boolean().optional(),
        status: z.enum(['active', 'lapsed', 'cancelled']).optional(),
        notes: z.string().max(2000).optional(),
      }),
      run: async (input, ctx) => {
        const { id, policy_number, ...rest } = input

        // An optional key that was not sent is undefined, not a write of null.
        const fields = Object.entries(rest).filter(
          ([key, value]) => value !== undefined && (PATCHABLE as readonly string[]).includes(key),
        )
        if (policy_number !== undefined) {
          fields.push(['policy_number_encrypted', encrypt(policy_number)])
        }

        if (id) {
          if (fields.length > 0) {
            const set = fields.map(([key], i) => `${key} = $${i + 2}`).join(', ')
            await db().query(`update insurance.policy set ${set} where id = $1`, [
              id,
              ...fields.map(([, value]) => value),
            ])
          }
          await postPremium(id, ctx)
          return { id }
        }

        if (!input.kind || !input.name) throw new Error('A new policy needs a kind and a name')

        const columns = fields.map(([key]) => key).join(', ')
        const params = fields.map((unused, i) => `$${i + 1}`).join(', ')
        const { rows } = await db().query<{ id: string }>(
          `insert into insurance.policy (${columns}) values (${params}) returning id`,
          fields.map(([, value]) => value),
        )

        await register({
          module: 'insurance',
          entityType: 'policy',
          entityId: rows[0].id,
          title: input.name,
          // The limits line is the useful text for search: it is what a person
          // remembers a policy by when they cannot remember the carrier.
          text: [input.carrier, input.limits].filter(Boolean).join(' '),
          eventType: 'policy_reviewed',
        })

        await postPremium(rows[0].id, ctx)
        return { id: rows[0].id }
      },
    }),

    renew_policy: defineTool({
      description: 'Move a policy on to its next term, keeping the same row and its history.',
      input: z.object({ id: z.uuid(), expires_on: date, premium_cents: z.number().int().min(0).optional() }),
      run: async ({ id, expires_on, premium_cents }, ctx) => {
        const { rows } = await db().query<{ name: string }>(
          `update insurance.policy
              set expires_on = $2,
                  premium_cents = coalesce($3, premium_cents),
                  status = 'active'
            where id = $1
            returning name`,
          [id, expires_on, premium_cents ?? null],
        )
        if (rows.length === 0) throw new Error(`No policy ${id}`)

        await register({
          module: 'insurance',
          entityType: 'policy',
          entityId: id,
          title: rows[0].name,
          eventType: 'policy_renewed',
        })

        await postPremium(id, ctx)
        return { id, expires_on }
      },
    }),

    delete_policy: defineTool({
      description: 'Delete a policy, its documents and their files.',
      input: z.object({ id: z.uuid() }),
      run: async ({ id }, ctx) => {
        // Finance first: if that fails the policy is still here to retry, where
        // the other order would orphan a premium nothing can reach.
        await unpostPremium(id, ctx)
        await deletePolicy(id)
        return { id }
      },
    }),

    attach_document: defineTool({
      description: 'Attach a file already in the insurance bucket to a policy.',
      input: ATTACH_INPUT,
      run: async ({ policy_id, name, meta, file_path }) => {
        await attachDocument(policy_id, name, meta, file_path)
        return { policy_id }
      },
    }),
  },

  /**
   * Everything that writes a policy is guarded.
   *
   * Cover is money and it is a commitment, and a wrong expiry date here is the
   * kind of mistake nobody notices until a claim. An agent proposing a change
   * lands in the Review inbox with the diff on it, which is exactly what that
   * inbox is for. Attaching a file is not guarded: it adds a document to the
   * owner's own row and changes nothing about the cover.
   */
  guarded: ['write_policy', 'renew_policy', 'delete_policy'],
  requires: [],
  calendar: calendarFor,

  metrics: {
    annual_premium: {
      label: 'Annual premium, all policies',
      unit: '$',
      get: async () => (await nightlyDigest()).annualCents / 100,
    },
    expiring_soon: {
      label: 'Policies expiring or expired',
      unit: 'policies',
      get: async () => (await nightlyDigest()).expiring.length,
    },
    /**
     * What Home reads for its property card. Named for the fact rather than the
     * screen that wants it, so a second reader does not need a second metric.
     */
    property_premium: {
      label: 'Property cover, annual',
      unit: '$',
      get: async () => {
        const policies = await listPolicies()
        return (
          policies
            .filter((p) => p.status === 'active' && ['renters', 'homeowners'].includes(p.kind))
            .reduce((sum, p) => sum + annualCents(p.premium_cents, p.cadence as Cadence), 0) / 100
        )
      },
    },
  },

  // Renewals, dated. A policy expiring is not a task to carry or drop, so this
  // module only ever contributes to what is coming.
  review: {
    upcoming: async () => {
      const { rows } = await db().query<{
        id: string
        name: string
        carrier: string
        expires_on: string
      }>(
        `select id, name, carrier, expires_on::text
           from insurance.policy
          where status = 'active'
            and expires_on is not null
            and expires_on >= core.today()
            and expires_on < core.today() + 60
          order by expires_on
          limit 8`,
      )

      return rows.map((r) => ({
        id: r.id,
        title: `${r.name} renews`,
        meta: r.carrier || 'No carrier recorded',
        at: r.expires_on,
        href: `/insurance?policy=${r.id}`,
      }))
    },
  },

  /** See ModuleManifest.tile: the module says how its own numbers read. */
  tile: InsuranceTile,

  jobs: [{ name: 'nightly_digest', run: remind }],
  entityHref: (t, id) => (t === 'policy' ? `/insurance?policy=${id}` : null),
  entityTypes: ['policy'],
})
