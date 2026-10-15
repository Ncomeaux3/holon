import { db } from '@/core/db'

export type BrainDigest = {
  /** Ingested, waiting for the owner to accept or reject. */
  inbox: number
  published: number
  /** Written in the last seven days. */
  writtenThisWeek: number
  byKind: Record<string, number>
  /** Links pointing at notes that do not exist. The most useful backlog there is. */
  unresolved: number
  /** Published notes not yet written to the vault. */
  uncommitted: number
  /** Published notes with no hub yet, rule or model. */
  unfiled: number
  hubs: { name: string; count: number }[]
}

export async function nightlyDigest(): Promise<BrainDigest> {
  const { rows } = await db().query<{
    inbox: string
    published: string
    week: string
    uncommitted: string
  }>(
    `select
       count(*) filter (where status = 'draft')::text as inbox,
       count(*) filter (where status = 'published')::text as published,
       count(*) filter (where status = 'published'
         and created_at >= now() - interval '7 days')::text as week,
       count(*) filter (where status = 'published' and committed_sha = '')::text as uncommitted
     from brain.note`,
  )

  const { rows: kinds } = await db().query<{ kind: string; n: string }>(
    `select kind, count(*)::text as n from brain.note where status = 'published' group by kind`,
  )

  const { rows: dangling } = await db().query<{ n: string }>(
    `select count(distinct to_slug)::text as n from brain.link where to_note_id is null`,
  )

  const { rows: unfiled } = await db().query<{ n: string }>(
    `select count(*)::text as n from brain.note n
      where status = 'published'
        and not exists (select 1 from brain.note_hub where note_id = n.id)`,
  )

  const { rows: hubs } = await db().query<{ name: string; count: string }>(
    `select h.name, count(nh.note_id)::text as count
       from brain.hub h
       left join brain.note_hub nh on nh.hub_id = h.id
      group by h.id, h.name
      order by count(nh.note_id) desc, h.name`,
  )

  return {
    inbox: Number(rows[0].inbox),
    published: Number(rows[0].published),
    writtenThisWeek: Number(rows[0].week),
    byKind: Object.fromEntries(kinds.map((k) => [k.kind, Number(k.n)])),
    unresolved: Number(dangling[0].n),
    uncommitted: Number(rows[0].uncommitted),
    unfiled: Number(unfiled[0].n),
    hubs: hubs.map((h) => ({ name: h.name, count: Number(h.count) })),
  }
}

/**
 * Re-point every dangling link whose target now exists.
 *
 * Runs nightly rather than only on write, because a link resolves when the
 * *other* note is created, and a note created through MCP or an import does not
 * go through the UI path that would notice.
 */
export async function resolveLinks(): Promise<{ resolved: number }> {
  const { rowCount } = await db().query(
    `update brain.link l
        set to_note_id = n.id
       from brain.note n
      where n.slug = l.to_slug and l.to_note_id is null`,
  )
  return { resolved: rowCount ?? 0 }
}
