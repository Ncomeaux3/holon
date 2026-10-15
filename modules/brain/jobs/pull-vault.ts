import { db } from '@/core/db'
import { register } from '@/core/entities'
import { getCredentials } from '@/core/credentials'
import { notes, read, VaultError } from '@/integrations/github_vault/client'
import { resolveDanglingLinks, syncLinks } from '../data'
import { fileByRules } from '../hubs'
import { slugify } from '../wikilinks'

// Pull the Obsidian vault. The vault is the source of truth, so this direction
// is a read and a mirror: a file that changed rewrites its note, and a note
// with no file behind it is left alone.
//
// Nothing here writes to the vault. The client has no function that could, and
// the other direction stays a draft in the inbox until the owner publishes it.

export type PullResult = {
  skipped: boolean
  /** Markdown files the vault holds. */
  found: number
  /** Files whose blob sha differed from what was stored, so they were read. */
  changed: number
  written: number
  /** Notes whose file has gone from the vault. Kept, never deleted. */
  orphaned: number
  detail: string
}

/**
 * Files read per run.
 *
 * Each one is its own request against a 5,000 an hour limit, so a first pull of
 * a large vault takes several nights to finish rather than spending the whole
 * budget at once. Every later run has almost nothing to do, because an unchanged
 * blob sha means no read at all.
 */
const MAX_READS = 300

/**
 * The note's title.
 *
 * A vault note's title is its first heading if it has one, and its file name
 * otherwise. Obsidian itself treats the file name as the title, so the file
 * name is the fallback rather than the other way round: a note whose first
 * line happens to be a heading about something else keeps the name you gave it
 * in the sidebar.
 */
export function titleOf(path: string, body: string): string {
  const fileName = path.split('/').pop()?.replace(/\.md$/i, '') ?? 'Untitled'
  if (fileName.trim() !== '') return fileName.trim()
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'Untitled'
}

/**
 * The slug a [[wikilink]] would use to reach this file.
 *
 * Obsidian links by file name, not by path, so `[[DDIA]]` reaches
 * `Books/Distributed/DDIA.md`. Slugging the file name rather than the path is
 * what makes a link written in the vault resolve here to the same note.
 */
export function slugOf(path: string): string {
  return slugify(path.split('/').pop()?.replace(/\.md$/i, '') ?? '')
}

/**
 * The kind, from where the file sits.
 *
 * A folder name is the only signal a vault gives, and it is a good one: people
 * put books in a Books folder. Unrecognised means `note`, which is the default
 * and is never wrong in a way that loses anything.
 */
export function kindOf(path: string): 'article' | 'book' | 'video' | 'note' | 'daily' | 'person' | 'project' {
  const folders = path.toLowerCase().split('/').slice(0, -1)
  if (folders.some((f) => /^(books?|reading)$/.test(f))) return 'book'
  if (folders.some((f) => /^(articles?|clippings?|web)$/.test(f))) return 'article'
  if (folders.some((f) => /^(videos?|talks?|youtube)$/.test(f))) return 'video'
  if (folders.some((f) => /^(daily|journal|dailies)$/.test(f))) return 'daily'
  if (folders.some((f) => /^(people|persons?)$/.test(f))) return 'person'
  if (folders.some((f) => /^(projects?)$/.test(f))) return 'project'
  return 'note'
}

/**
 * Frontmatter is metadata, not prose.
 *
 * Left in, it becomes the first thing search matches on and the first thing the
 * preview shows, so every note reads as a block of YAML. Only a block that
 * starts the file counts: three dashes further down are a horizontal rule.
 */
export function stripFrontmatter(body: string): string {
  const match = body.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return match ? body.slice(match[0].length) : body
}

type Stored = { external_id: string; vault_sha: string }

export async function pullVault(): Promise<PullResult> {
  const creds = await getCredentials('github_vault')
  if (!creds?.repo || !creds?.token) {
    return {
      skipped: true,
      found: 0,
      changed: 0,
      written: 0,
      orphaned: 0,
      detail: 'The vault is not connected.',
    }
  }

  let listing
  try {
    listing = await notes()
  } catch (error) {
    if (error instanceof VaultError) {
      return {
        skipped: true,
        found: 0,
        changed: 0,
        written: 0,
        orphaned: 0,
        detail: error.message,
      }
    }
    throw error
  }

  const { rows } = await db().query<Stored>(
    `select external_id, vault_sha from brain.note where source = 'vault'`,
  )
  const stored = new Map(rows.map((r) => [r.external_id, r.vault_sha]))

  // An unchanged blob sha means an unchanged file, so there is nothing to read
  // and nothing to write. This is why a nightly pull over a settled vault costs
  // one request.
  const changed = listing.notes.filter((n) => stored.get(n.path) !== n.sha)
  const batch = changed.slice(0, MAX_READS)

  let written = 0
  for (const file of batch) {
    const raw = await read(file.sha)
    const body = stripFrontmatter(raw)

    const { rows: saved } = await db().query<{ id: string; slug: string }>(
      `insert into brain.note
         (title, body, slug, kind, status, vault_sha, source, external_id)
       values ($1, $2, $3, $4, 'published', $5, 'vault', $6)
       on conflict (source, external_id) do update
         set title = excluded.title,
             body = excluded.body,
             kind = excluded.kind,
             vault_sha = excluded.vault_sha,
             updated_at = now()
       returning id, slug`,
      [titleOf(file.path, body), body, slugOf(file.path), kindOf(file.path), file.sha, file.path],
    )

    const note = saved[0]
    await syncLinks(note.id, body)
    await resolveDanglingLinks(note.slug, note.id)

    // emit: false, because these are notes that already existed. Four hundred
    // notes written over five years are not four hundred notes of work tonight,
    // and the Skill Tree would say otherwise for exactly one evening and then
    // be wrong forever. The row still registers, so search can reach it.
    await register({
      module: 'brain',
      entityType: 'note',
      entityId: note.id,
      title: titleOf(file.path, body),
      text: body.slice(0, 4000),
      emit: false,
    })
    await fileByRules(note.id, titleOf(file.path, body), body)

    written++
  }

  // A file that has gone is not a note that has gone. Deleting here would throw
  // away a note the owner may have moved, renamed, or removed by accident, and
  // the vault is a git repo so the app is not the last copy either way.
  const remote = new Set(listing.notes.map((n) => n.path))
  const orphaned = rows.filter((r) => !remote.has(r.external_id)).length

  const parts = [`${listing.notes.length} files, ${written} written`]
  if (changed.length > batch.length) {
    parts.push(`${changed.length - batch.length} left for the next run`)
  }
  if (orphaned > 0) parts.push(`${orphaned} notes no longer have a file`)
  if (listing.truncated) parts.push('the vault tree was truncated, so this is a floor')

  return {
    skipped: false,
    found: listing.notes.length,
    changed: changed.length,
    written,
    orphaned,
    detail: parts.join('. '),
  }
}
