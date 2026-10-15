import { db } from '@/core/db'
import { decrypt } from '@/core/crypto'
import { remove } from '@/core/files'
import { maskNumber } from './premium'

// Reads for the screen and the digest. The premium and expiry arithmetic lives
// in ./premium.ts, which has no imports and can be pulled into a client.

export type PolicyRow = {
  id: string
  kind: string
  name: string
  carrier: string
  expires_on: string | null
  premium_cents: number
  cadence: string
  deductible_cents: number | null
  limits: string
  agent_name: string
  agent_contact: string
  reminder_leads: number[]
  post_to_finance: boolean
  status: string
  notes: string
  /** Masked here, in the query. The plaintext never leaves this file uninvited. */
  masked_number: string
  document_count: number
}

/**
 * Every policy, with the number already masked.
 *
 * The encrypted column is decrypted only to take its last four characters, and
 * the plaintext is not put on the row. A list payload that carried policy
 * numbers would put them in the page source of every screen that renders one.
 */
export async function listPolicies(): Promise<PolicyRow[]> {
  const { rows } = await db().query<Omit<PolicyRow, 'masked_number'> & {
    policy_number_encrypted: string | null
  }>(
    `select p.id, p.kind, p.name, p.carrier, p.policy_number_encrypted,
            p.expires_on::text, p.premium_cents, p.cadence, p.deductible_cents,
            p.limits, p.agent_name, p.agent_contact, p.reminder_leads,
            p.post_to_finance, p.status, p.notes,
            (select count(*)::int from insurance.document d where d.policy_id = p.id)
              as document_count
       from insurance.policy p
      -- Sorted by what expires first, which is the only order the screen has a
      -- reason to use. Nulls last: an undated policy is not the most urgent.
      order by p.expires_on asc nulls last`,
  )

  return rows.map(({ policy_number_encrypted, ...policy }) => ({
    ...policy,
    masked_number: policy_number_encrypted
      ? maskNumber(decrypt(policy_number_encrypted))
      : 'not on file',
  }))
}

/**
 * The plaintext policy number for one policy.
 *
 * Its own function, called only by the reveal action, so that reading a policy
 * number is always a deliberate act with an id behind it rather than a field
 * that rides along in a list.
 */
export async function revealNumber(id: string): Promise<string> {
  const { rows } = await db().query<{ policy_number_encrypted: string | null }>(
    `select policy_number_encrypted from insurance.policy where id = $1`,
    [id],
  )
  if (rows.length === 0) throw new Error('No such policy')
  if (!rows[0].policy_number_encrypted) return 'not on file'
  return decrypt(rows[0].policy_number_encrypted)
}

export type DocumentRow = {
  id: string
  policy_id: string
  name: string
  meta: string
  file_path: string | null
}

export async function listDocuments(): Promise<DocumentRow[]> {
  const { rows } = await db().query<DocumentRow>(
    `select id, policy_id, name, meta, file_path
       from insurance.document order by created_at desc`,
  )
  return rows
}

export async function ownerToday(): Promise<string> {
  const { rows } = await db().query<{ today: string }>(`select core.today()::text as today`)
  return rows[0].today
}

/** The channels the policy renewal rule fires on, or null when it is muted. */
export async function renewalChannels(): Promise<string[] | null> {
  const { rows } = await db().query<{ channels: string[]; muted: boolean }>(
    `select channels, muted from core.notification_rules
      where module = 'insurance' and key = 'policy_renewal' limit 1`,
  )
  const rule = rows[0]
  return rule && !rule.muted ? rule.channels : null
}

/**
 * Remove a policy, its registry row and its documents' files.
 *
 * The document rows cascade with the policy; the files in the bucket do not,
 * so they go first. The registry row goes so the policy stops turning up in
 * search; its events stay, unlinked, because the log is append only.
 */
export async function deletePolicy(id: string): Promise<void> {
  const { rows } = await db().query<{ file_path: string }>(
    `select file_path from insurance.document where policy_id = $1 and file_path is not null`,
    [id],
  )
  // Only files under this policy's own prefix: a document row pointing
  // elsewhere must not delete another policy's file.
  for (const doc of rows) {
    if (doc.file_path.startsWith(`${id}/`)) await remove({ module: 'insurance', path: doc.file_path })
  }
  await db().query(
    `delete from core.entities where module = 'insurance' and entity_type = 'policy' and entity_id = $1`,
    [id],
  )
  await db().query(`delete from insurance.policy where id = $1`, [id])
}

export async function attachDocument(
  policyId: string,
  name: string,
  meta: string,
  filePath: string,
): Promise<void> {
  await db().query(
    `insert into insurance.document (policy_id, name, meta, file_path) values ($1, $2, $3, $4)`,
    [policyId, name, meta, filePath],
  )
}
