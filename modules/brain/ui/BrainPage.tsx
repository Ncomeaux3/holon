import { db } from '@/core/db'
import { getSkillNames } from '@/core/modules'
import { listSkillLinks } from '@/core/skill-links'
import { listHubs, listNoteHubs, listNotes } from '../data'
import { Brain, type BrainData } from './Brain'

export default async function BrainPage() {
  const [notes, links, skillLinks, skillNames, hubs, noteHubs] = await Promise.all([
    listNotes(),
    // Backlinks and dangling targets for every note in one pass. One query
    // rather than one per note: the panel needs them for whichever note is
    // opened, and opening one should not cost a round trip.
    db().query<{ from_note_id: string; to_note_id: string | null; to_slug: string }>(
      `select from_note_id, to_note_id, to_slug from brain.link`,
    ),
    listSkillLinks('brain', 'note'),
    getSkillNames(),
    listHubs(),
    listNoteHubs(),
  ])

  const byId = new Map(notes.map((n) => [n.id, n]))
  const hubById = new Map(hubs.map((h) => [h.id, h]))

  const data: BrainData = {
    notes: notes.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      slug: n.slug,
      kind: n.kind,
      status: n.status,
      sourceUrl: n.source_url,
      sourceText: n.source_text,
      sourceMeta: n.source_meta,
      source: n.source,
      externalId: n.external_id,
      vaultSha: n.vault_sha,
      filePath: n.file_path,
      updatedAt: new Date(n.updated_at).toISOString(),
      backlinks: links.rows
        .filter((l) => l.to_note_id === n.id)
        .map((l) => byId.get(l.from_note_id))
        .filter((from) => from !== undefined)
        .map((from) => ({ id: from.id, title: from.title, slug: from.slug })),
      // A link to a note that does not exist yet. Kept and shown, because it is
      // usually the best idea of what to write next.
      unresolved: links.rows
        .filter((l) => l.from_note_id === n.id && l.to_note_id === null)
        .map((l) => l.to_slug),
      entityRef: skillLinks.get(n.id)?.entityRef ?? null,
      skills: skillLinks.get(n.id)?.skills ?? [],
      hubs: noteHubs
        .filter((h) => h.note_id === n.id && hubById.has(h.hub_id))
        .map((h) => ({
          id: h.hub_id,
          name: hubById.get(h.hub_id)!.name,
          by: h.is_manual ? 'manual' : h.classified_by === 'rule' ? 'rule' : 'model',
        })),
    })),
    hubs: hubs.map((h) => ({ id: h.id, name: h.name, slug: h.slug, keywords: h.keywords })),
    skills: Object.entries(skillNames),
  }

  return (
    <>
      {/* Drawn nowhere and present all the same: the artboard has no title
        * block, and a page with no heading is one a screen reader cannot
        * announce. */}
      <h1 className="sr-only">Second Brain</h1>
      <Brain data={data} />
    </>
  )
}
