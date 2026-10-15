import { z } from 'zod'
import { db } from '@/core/db'
import { register } from '@/core/entities'
import { emit } from '@/core/events'
import { defineModule, defineTool } from '@/core/module-contract'
import { captureText, transcribePending } from './capture'
import { deleteNote, resolveDanglingLinks, syncLinks, uniqueSlug } from './data'
import { fileUnfiledNightly } from './hubs'
import { nightlyDigest, resolveLinks } from './jobs/nightly-digest'
import { pullVault } from './jobs/pull-vault'
import { ingestUrl } from './ingest'
import BrainPage from './ui/BrainPage'
import { BrainTile } from './ui/Tile'

const kind = z.enum(['article', 'book', 'video', 'note', 'project', 'person', 'daily'])

export default defineModule({
  id: 'brain',
  nav: { label: 'Second Brain', icon: 'brain', order: 40 },
  pages: { '': BrainPage },

  tools: {
    get_digest: defineTool({
      description: 'Inbox depth, what was written this week, and how many links point at nothing.',
      input: z.object({}),
      run: () => nightlyDigest(),
    }),

    capture: defineTool({
      description:
        'Save typed text as a note. First line is the title. worked marks a "worked on" entry (kind daily). An agent writes a draft.',
      input: z.object({ text: z.string().min(1).max(200_000), worked: z.boolean().optional() }),
      run: (input, ctx) => captureText(input, ctx.source === 'agent' ? 'agent' : 'manual'),
    }),

    ingest: defineTool({
      description:
        'Read a URL or a YouTube video and draft a note from it. Spends money: one Haiku call per ingest.',
      input: z.object({ url: z.string().min(4).max(2000), kind: kind.optional() }),
      run: async ({ url, kind: folder }) => {
        const found = await ingestUrl(url)
        const slug = await uniqueSlug(found.title)

        // Always a draft, whoever asked. The other tools let the owner write
        // directly because the owner is the source of truth; this one produces
        // something a model wrote, and that is exactly what the inbox is for.
        const { rows } = await db().query<{ id: string }>(
          `insert into brain.note
             (title, body, slug, kind, status, source_url, source_text, source_meta, source)
           values ($1, $2, $3, $4, 'draft', $5, $6, $7, 'agent')
           returning id`,
          [
            found.title,
            found.summary,
            slug,
            folder ?? found.kind,
            found.sourceUrl,
            found.sourceText,
            found.note.slice(0, 300),
          ],
        )

        await syncLinks(rows[0].id, found.summary)
        await resolveDanglingLinks(slug, rows[0].id)

        await register({
          module: 'brain',
          entityType: 'note',
          entityId: rows[0].id,
          title: found.title,
          text: found.summary,
          // A draft is a proposal about a note. It earns nothing until the
          // owner accepts it, which is what publish is for.
          eventType: 'note_ingested',
        })

        return { id: rows[0].id, slug, title: found.title, note: found.note }
      },
    }),

    write: defineTool({
      description:
        'Create or update a note. An agent writes a draft; only the owner publishes one.',
      input: z.object({
        id: z.uuid().optional(),
        title: z.string().min(1).max(300).optional(),
        body: z.string().max(200_000).optional(),
        kind: kind.optional(),
        source_url: z.string().max(2000).optional(),
        source_text: z.string().max(500_000).optional(),
        source_meta: z.string().max(300).optional(),
      }),
      run: async (input, ctx) => {
        if (input.id) {
          const fields = Object.entries(input).filter(([key]) => key !== 'id')
          if (fields.length > 0) {
            // Every key is a literal from the zod schema above, a closed set.
            const set = fields.map(([key], i) => `${key} = $${i + 2}`).join(', ')
            await db().query(`update brain.note set ${set} where id = $1`, [
              input.id,
              ...fields.map(([, value]) => value),
            ])
          }

          if (input.body !== undefined) await syncLinks(input.id, input.body)
          // No register() on an update: it emits the creation event, and a note
          // edited twice would award its XP twice.
          return { id: input.id }
        }

        if (!input.title) throw new Error('A new note needs a title')

        // An agent writes a draft. The vault is the source of truth and the app
        // never adds to it without a review step, so `published` is a state
        // only the owner can put a note into.
        const status = ctx.source === 'agent' ? 'draft' : 'published'
        const slug = await uniqueSlug(input.title)

        const { rows } = await db().query<{ id: string }>(
          `insert into brain.note
             (title, body, slug, kind, status, source_url, source_text, source_meta, source)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           returning id`,
          [
            input.title,
            input.body ?? '',
            slug,
            input.kind ?? 'note',
            status,
            input.source_url ?? '',
            input.source_text ?? '',
            input.source_meta ?? '',
            ctx.source === 'agent' ? 'agent' : 'manual',
          ],
        )

        await syncLinks(rows[0].id, input.body ?? '')
        // Anything that was already linking to this title now points at it.
        await resolveDanglingLinks(slug, rows[0].id)

        await register({
          module: 'brain',
          entityType: 'note',
          entityId: rows[0].id,
          title: input.title,
          text: input.body,
          // A draft is a proposal about a note, not a note. It earns nothing
          // until the owner accepts it.
          eventType: status === 'draft' ? 'note_ingested' : undefined,
        })

        return { id: rows[0].id, slug, status }
      },
    }),

    publish: defineTool({
      description: 'Accept a draft into the vault, or send a published note back to the inbox.',
      input: z.object({ id: z.uuid(), publish: z.boolean().default(true) }),
      run: async ({ id, publish }) => {
        const { rows } = await db().query<{ title: string; kind: string }>(
          `update brain.note set status = $2 where id = $1 returning title, kind`,
          [id, publish ? 'published' : 'draft'],
        )
        if (rows.length === 0) throw new Error(`No note ${id}`)

        if (publish) {
          const entityRef = await register({
            module: 'brain',
            entityType: 'note',
            entityId: id,
            title: rows[0].title,
            eventType: 'note_approved',
          })
          // Adding a book or an article here means it was read (decision
          // 2026-09-11): accepting one is finishing it, which is the skill
          // event SPEC names. Emitted directly so the classifier runs once.
          const finished = { book: 'book_finished', article: 'article_read' }[rows[0].kind]
          if (finished) {
            await emit({ module: 'brain', entityRef, eventType: finished, titleSnapshot: rows[0].title })
          }
        }

        return { id, status: publish ? 'published' : 'draft' }
      },
    }),

    delete: defineTool({
      description: 'Discard a draft, or remove a note the app holds. Never touches the vault.',
      input: z.object({ id: z.uuid() }),
      run: async ({ id }) => {
        await deleteNote(id)
        return { id }
      },
    }),
  },

  /**
   * Ingest and delete are guarded. Nothing else in this module is.
   *
   * The original reasoning still holds for every other tool: the draft state
   * already is the review step, so an agent cannot publish anything. `write`
   * from an agent produces a draft whatever it asks for, and `publish` is
   * reached from the inbox. Guarding those would put one decision behind two
   * approvals.
   *
   * Ingest is different for the reason Ideas guards research and nothing else.
   * It spends real money on every call, and the draft state does not guard
   * against that: an agent that decided to ingest forty links one night would
   * be inside the monthly cap and still wrong. The owner pasting a URL is the
   * approval; an agent asking lands in the Review inbox.
   */
  guarded: ['ingest', 'delete'],

  requires: ['github_vault'],

  metrics: {
    notes_written: {
      label: 'Notes written',
      unit: 'notes',
      get: async () => {
        const { rows } = await db().query<{ n: string }>(
          `select count(*)::text as n from brain.note where status = 'published'`,
        )
        return Number(rows[0].n)
      },
    },
    books_finished: {
      label: 'Books finished',
      unit: 'books',
      get: async () => {
        const { rows } = await db().query<{ n: string }>(
          `select count(*)::text as n from brain.note
            where status = 'published' and kind = 'book'`,
        )
        return Number(rows[0].n)
      },
    },
  },

  // Notes published this week. A draft is not a win: the whole point of the
  // draft state is that nobody has read it yet.
  review: {
    wins: async () => {
      const { rows } = await db().query<{ kind: string; n: string }>(
        `select kind, count(*)::text as n
           from brain.note
          where status = 'published'
            and updated_at >= core.today() - interval '7 days'
          group by kind
          order by count(*) desc`,
      )

      const total = rows.reduce((sum, r) => sum + Number(r.n), 0)
      if (total === 0) return []

      const books = Number(rows.find((r) => r.kind === 'book')?.n ?? 0)

      return [
        {
          id: 'brain-week',
          title: `${total} note${total === 1 ? '' : 's'} filed`,
          meta: `Second Brain · ${rows.map((r) => `${r.n} ${r.kind}`).join(' · ')}`,
          tag: books > 0 ? `${books} book${books === 1 ? '' : 's'}` : undefined,
        },
      ]
    },
  },

  /** See ModuleManifest.tile: the module says how its own numbers read. */
  tile: BrainTile,

  jobs: [
    // First: everything below reads what the vault brought in.
    { name: 'pull_vault', run: pullVault },
    {
      name: 'file_unfiled',
      // A file the cap stopped is transcribed first so it can be filed the same night.
      run: async () => ({ ...(await transcribePending()), ...(await fileUnfiledNightly()) }),
    },
    { name: 'resolve_links', run: resolveLinks },
    { name: 'nightly_digest', run: nightlyDigest },
  ],
  entityHref: (t, id) => (t === 'note' ? `/brain?note=${id}` : null),
  entityTypes: ['note'],
})
