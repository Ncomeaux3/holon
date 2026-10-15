import { db } from '@/core/db'
import { register } from '@/core/entities'
import { resolveDanglingLinks, syncLinks } from './data'
import { slugify } from './wikilinks'

// Synthetic rows for `pnpm setup --demo`. Upserts on external_id so running it
// twice does not duplicate. Nothing here is personal; this ships in the template.
//
// The notes link to each other, and one links to a note that does not exist, so
// the backlinks panel and the "links with nothing behind them" list both have
// something real in them rather than being empty boxes in the demo.

const NOTES: {
  external_id: string
  title: string
  kind: 'article' | 'book' | 'video' | 'note' | 'project' | 'person' | 'daily'
  status: 'draft' | 'published'
  body: string
  sourceMeta?: string
  sourceUrl?: string
  sourceText?: string
  /** A note pulled from the vault: its file path, and the blob sha it was read at. */
  vault?: { path: string; sha: string }
}[] = [
  {
    external_id: 'demo-rrf',
    title: 'Reciprocal rank fusion',
    kind: 'note',
    status: 'published',
    body: [
      'Merge a vector ranking and a full text ranking with 1/(k + rank). k = 60 is the',
      'constant the original paper uses, and it needs no score normalisation, which is',
      'why it beats a weighted sum in practice.',
      '',
      'Two CTEs, one outer select, limit twenty.',
      '',
      'See [[Hybrid search]] for where this came from.',
    ].join('\n'),
  },
  {
    external_id: 'demo-hybrid',
    title: 'Hybrid search',
    kind: 'video',
    status: 'published',
    body: [
      'Full text is precise on names and identifiers. Vectors are forgiving on phrasing.',
      'Neither wins alone, which is the whole argument for fusing them.',
      '',
      'The method is [[Reciprocal rank fusion]].',
    ].join('\n'),
    sourceMeta: 'Video, 24 min',
    sourceText: 'Transcript excerpt: so if you take the keyword result list and the vector result list, and for each document add one over sixty plus its rank in each, you get a fused score that is surprisingly hard to beat.',
  },
  {
    // Pulled from the vault, so the Vault cell has a path and a sha to show
    // and the Edit button has a note to stay away from.
    external_id: 'demo-boring',
    title: 'The boring technology club',
    kind: 'article',
    status: 'published',
    body: [
      'Every new technology costs innovation tokens. Spend them on the product, not',
      'the stack.',
      '',
      'The POS stack is deliberately boring: Postgres, Next.js, one cron. The order it',
      'is built in is [[Build order]].',
    ].join('\n'),
    vault: { path: 'Articles/The boring technology club.md', sha: 'a1f9c2e4b7d0' },
  },
  {
    external_id: 'demo-mom-test',
    title: 'The Mom Test',
    kind: 'book',
    status: 'published',
    body: [
      'Ask about their life, not your idea. Talk about specifics in the past, not',
      'generics about the future.',
    ].join('\n'),
    sourceMeta: 'Book notes, by hand',
  },
  {
    external_id: 'demo-ddia',
    title: 'Designing Data-Intensive Applications, ch. 5',
    kind: 'book',
    status: 'published',
    body: [
      'Single leader replication is the default for a reason: it is simple to reason',
      'about and it matches Postgres. Async replicas lag, so read-your-writes needs',
      'routing or timestamps.',
      '',
      'At this scale replication is not the concern. Backups and restore drills are.',
    ].join('\n'),
    sourceMeta: 'Book notes, by hand',
  },
  {
    external_id: 'demo-draft-1',
    title: 'Why solo builders ship one module at a time',
    kind: 'article',
    status: 'draft',
    // A summary the way Haiku writes one: paragraphs, no hard wraps, so the
    // draft card's pre-wrap shows it as it would arrive.
    body: [
      'Scope creep is the default state of a side project. The fix is structure, not discipline: pick one module, define done before starting, ship it to the point of daily use, then start the next.',
      '',
      'Three rules worth keeping:',
      '1. Never have two modules at twenty percent.',
      '2. The old tool stays until the new one has been used for a week.',
      '3. Import history first. A module with no past feels empty and gets abandoned.',
      '',
      'Related: [[Build order]].',
    ].join('\n'),
    sourceMeta: 'URL, 1,840 words',
    sourceUrl: 'https://example.com/one-module-at-a-time',
    sourceText:
      'The itch to start module two arrives around the time module one becomes boring, which is roughly sixty percent of the way to done. Every side project I have abandoned died at exactly this point, and none of them died from a lack of ideas.',
  },
  {
    external_id: 'demo-draft-2',
    title: 'Postgres full text search, briefly',
    kind: 'article',
    status: 'draft',
    body: 'tsvector plus a GIN index covers the exact match cases a vector misses: identifiers, names, error strings. It costs nothing per query, which is the argument for running it first and only paying for meaning when words find nothing.',
    sourceMeta: 'URL, 900 words',
    sourceUrl: 'https://example.com/postgres-fts',
    sourceText:
      'to_tsvector and to_tsquery do the work; the GIN index makes it fast. Ranking with ts_rank_cd is usually good enough that reaching for anything heavier is premature.',
  },
]

export async function seed(): Promise<number> {
  for (const note of NOTES) {
    const slug = slugify(note.title)

    const { rows } = await db().query<{ id: string }>(
      `insert into brain.note
         (title, body, slug, kind, status, source_url, source_text, source_meta,
          source, external_id, vault_sha)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (source, external_id) do update
         set title = excluded.title, body = excluded.body, status = excluded.status
       returning id`,
      [
        note.title,
        note.body,
        slug,
        note.kind,
        note.status,
        note.sourceUrl ?? '',
        note.sourceText ?? '',
        note.sourceMeta ?? '',
        note.vault ? 'vault' : 'demo',
        note.vault ? note.vault.path : note.external_id,
        note.vault?.sha ?? '',
      ],
    )

    await syncLinks(rows[0].id, note.body)
    await resolveDanglingLinks(slug, rows[0].id)

    // Same path as a real write, so the demo data exercises classification and
    // the event log rather than sitting inert. A draft earns nothing, which is
    // what the ingest weight of zero says.
    await register({
      module: 'brain',
      entityType: 'note',
      entityId: rows[0].id,
      title: note.title,
      text: note.body,
      eventType: note.status === 'draft' ? 'note_ingested' : undefined,
      replace: true,
    })
  }

  // One link in demo-draft-1 points at [[Build order]], which nothing writes.
  // That is deliberate: it is what puts a real entry in the "links with nothing
  // behind them" list instead of an empty card.
  return NOTES.length
}
