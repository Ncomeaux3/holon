import { db } from '@/core/db'
import { encrypt } from '@/core/crypto'
import { register } from '@/core/entities'
import { postPremium } from './post'

// Synthetic rows for `pnpm setup --demo`. Upserts on external_id so running it
// twice does not duplicate. Nothing here is personal: the carriers, policy
// numbers, premiums and agents are all made up.

const POLICIES: {
  external_id: string
  kind: string
  name: string
  carrier: string
  number: string
  /** Days from today, so the demo always has one expiring and one comfortable. */
  expiresInDays: number
  premiumCents: number
  cadence: 'monthly' | 'quarterly' | 'semiannual' | 'annual'
  deductibleCents: number | null
  limits: string
  agentName: string
  agentContact: string
  leads?: number[]
  postToFinance?: boolean
  documents?: [string, string][]
}[] = [
  {
    external_id: 'p-renters', kind: 'renters', name: 'Apartment, renters', carrier: 'Harbor Mutual',
    number: 'HBM-30517-6624', expiresInDays: 36, premiumCents: 1_600, cadence: 'monthly',
    deductibleCents: 50_000, limits: '$25k contents, $100k liability',
    agentName: 'Harbor Mutual app', agentContact: 'support@example.com', postToFinance: true,
    documents: [['renters-declarations-2026.pdf', '2 pages, Nov 2025']],
  },
  {
    external_id: 'p-device', kind: 'device', name: 'Phone, theft and loss', carrier: 'Pocketguard',
    number: 'PG-61842-0357', expiresInDays: 58, premiumCents: 1_199, cadence: 'monthly',
    deductibleCents: 12_900, limits: '2 incidents per 12 months',
    agentName: '', agentContact: 'example.com/support', postToFinance: true,
  },
  {
    external_id: 'p-auto', kind: 'auto', name: '2015 sedan, full coverage', carrier: 'Keystone Auto',
    number: '604-17-5582-3', expiresInDays: 112, premiumCents: 58_800, cadence: 'semiannual',
    deductibleCents: 100_000, limits: '100/300/100, comprehensive and collision',
    agentName: 'Dana Whitfield', agentContact: '(555) 010-0142', leads: [60, 14], postToFinance: true,
    documents: [['auto-policy-2026.pdf', '9 pages, May 2026'], ['id-cards.pdf', '1 page']],
  },
  {
    external_id: 'p-pet', kind: 'pet', name: 'Cat, accident and illness', carrier: 'Meadow Pet Cover',
    number: 'MPC-0417-28813', expiresInDays: 141, premiumCents: 4_200, cadence: 'monthly',
    deductibleCents: 25_000, limits: '90% reimbursement, no annual cap',
    agentName: '', agentContact: '(555) 010-0198',
  },
  {
    external_id: 'p-dental', kind: 'dental', name: 'Dental PPO', carrier: 'Brightsmile Dental',
    number: 'BSD-55208-1196', expiresInDays: 207, premiumCents: 2_700, cadence: 'monthly',
    deductibleCents: 5_000, limits: '$1,500 annual maximum',
    agentName: 'HR portal', agentContact: 'benefits@example.com', leads: [30],
  },
  {
    external_id: 'p-health', kind: 'health', name: 'Health, Silver PPO', carrier: 'Juniper Health Plan',
    number: 'JHP-6130-27419-2', expiresInDays: 207, premiumCents: 38_600, cadence: 'monthly',
    deductibleCents: 250_000, limits: '$7,000 out of pocket max, $30 copay',
    agentName: 'HR portal', agentContact: 'benefits@example.com', leads: [30],
    documents: [['sbc-2026.pdf', '8 pages']],
  },
  {
    // Deductible null rather than zero: term life does not have one, which is a
    // different fact from a deductible of nothing.
    external_id: 'p-life', kind: 'life', name: 'Term life, 20 year', carrier: 'Northstar Life',
    number: 'NSL-4810-27736', expiresInDays: 255, premiumCents: 3_300, cadence: 'monthly',
    deductibleCents: null, limits: '$750k, term to 2046',
    agentName: '', agentContact: '(555) 010-0107',
  },
]

export async function seed(): Promise<number> {
  for (const policy of POLICIES) {
    const { rows } = await db().query<{ id: string }>(
      `insert into insurance.policy
         (kind, name, carrier, policy_number_encrypted, expires_on, premium_cents,
          cadence, deductible_cents, limits, agent_name, agent_contact,
          reminder_leads, post_to_finance, source, external_id)
       values ($1, $2, $3, $4, core.today() + $5::int, $6, $7, $8, $9, $10, $11,
               $12, $13, 'demo', $14)
       on conflict (source, external_id) do update
         set expires_on = excluded.expires_on,
             premium_cents = excluded.premium_cents,
             deductible_cents = excluded.deductible_cents,
             limits = excluded.limits
       returning id`,
      [
        policy.kind,
        policy.name,
        policy.carrier,
        encrypt(policy.number),
        policy.expiresInDays,
        policy.premiumCents,
        policy.cadence,
        policy.deductibleCents,
        policy.limits,
        policy.agentName,
        policy.agentContact,
        policy.leads ?? [60, 30, 7],
        policy.postToFinance ?? false,
        policy.external_id,
      ],
    )

    await register({
      module: 'insurance',
      entityType: 'policy',
      entityId: rows[0].id,
      title: policy.name,
      text: `${policy.carrier} ${policy.limits}`,
      eventType: 'policy_reviewed',
      replace: true,
    })

    // Through Finance's tool, as the drawer's save does, so a posted premium is
    // on the Finance screen in the demo too.
    await postPremium(rows[0].id, { source: 'ui' })

    // Documents are a list owned by the policy, so they are cleared and
    // rewritten rather than diffed. None of them has a file behind it in the
    // demo: the row is what the screen shows.
    await db().query(
      `delete from insurance.document where policy_id = $1 and file_path is null`,
      [rows[0].id],
    )
    for (const [name, meta] of policy.documents ?? []) {
      await db().query(
        `insert into insurance.document (policy_id, name, meta) values ($1, $2, $3)`,
        [rows[0].id, name, meta],
      )
    }
  }

  return POLICIES.length
}
