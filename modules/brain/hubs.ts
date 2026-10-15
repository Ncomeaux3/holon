import { db } from '@/core/db'
import { complete, NotConnected, SoftCapExceeded } from '@/core/llm'

// Filing a note into a hub. Rules first, same as skills: a keyword hit is
// synchronous and free, and only what rules miss waits on the nightly model
// pass. See modules/skills/classify.ts.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Blank out fenced and inline code, same two replaces as wikilinks.ts maskCode. */
function maskCode(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, (block) => ' '.repeat(block.length))
    .replace(/`[^`\n]*`/g, (span) => ' '.repeat(span.length))
}

/**
 * Deterministic pass. Word boundary matched, case insensitive, and blind to
 * code so a keyword inside a snippet does not file the note. Pure.
 */
export function matchHubs(text: string, hubs: { id: string; keywords: string[] }[]): string[] {
  const masked = maskCode(text)
  const hits = new Set<string>()
  for (const hub of hubs) {
    for (const keyword of hub.keywords) {
      if (new RegExp(`\\b${escape(keyword)}\\b`, 'i').test(masked)) {
        hits.add(hub.id)
        break
      }
    }
  }
  return [...hits]
}

/** Files one note into every hub whose keyword it mentions. Never touches a manual row. */
export async function fileByRules(noteId: string, title: string, body: string): Promise<void> {
  const { rows: hubs } = await db().query<{ id: string; keywords: string[] }>(
    `select id, keywords from brain.hub`,
  )
  if (hubs.length === 0) return

  const hits = matchHubs(`${title}\n${body}`, hubs)
  for (const hubId of hits) {
    await db().query(
      `insert into brain.note_hub (note_id, hub_id, confidence, classified_by)
       values ($1, $2, 1, 'rule')
       on conflict do nothing`,
      [noteId, hubId],
    )
  }
}

/**
 * Re-run the rules over every note with no hub yet.
 *
 * hubId names what the caller is chasing, but there is no cheap way to find
 * "notes that would now match this one hub" without re-running the match, so
 * this runs fileByRules over every unfiled note regardless of which hub asked.
 */
export async function refileByRules(hubId: string): Promise<number> {
  void hubId
  const { rows: notes } = await db().query<{ id: string; title: string; body: string }>(
    `select id, title, body from brain.note n
      where status = 'published'
        and not exists (select 1 from brain.note_hub where note_id = n.id)`,
  )

  for (const note of notes) await fileByRules(note.id, note.title, note.body)
  return notes.length
}

/** The owner's own edit. Ticking or unticking a hub always wins over a rule or a guess. */
export async function setHubs(noteId: string, hubIds: string[]): Promise<void> {
  await db().query(`delete from brain.note_hub where note_id = $1 and not is_manual`, [noteId])
  await db().query(
    `delete from brain.note_hub where note_id = $1 and is_manual and hub_id <> all($2::uuid[])`,
    [noteId, hubIds],
  )

  for (const hubId of hubIds) {
    await db().query(
      `insert into brain.note_hub (note_id, hub_id, confidence, classified_by, is_manual)
       values ($1, $2, 1, 'manual', true)
       on conflict (note_id, hub_id) do update set classified_by = 'manual', is_manual = true`,
      [noteId, hubId],
    )
  }
}

type ModelHit = { note_id: string; hub_slug: string; confidence: number }

/**
 * The nightly catch for what the rules missed. One batched call rather than
 * one per note, same reasoning as skills/jobs/reclassify.ts.
 */
export async function fileUnfiledNightly(): Promise<{ filed: number; reason?: string }> {
  const { rows: notes } = await db().query<{ id: string; title: string; body: string }>(
    // ponytail: 50 notes per call; page it if Unfiled ever holds more.
    `select id, title, left(body, 2000) as body from brain.note n
      where status = 'published'
        and not exists (select 1 from brain.note_hub where note_id = n.id)
      limit 50`,
  )
  if (notes.length === 0) return { filed: 0 }

  const { rows: hubs } = await db().query<{ id: string; slug: string; name: string; keywords: string[] }>(
    `select id, slug, name, keywords from brain.hub`,
  )
  if (hubs.length === 0) return { filed: 0 }

  let reply: string
  try {
    reply = await complete({
      model: 'claude-haiku-4-5',
      purpose: 'classification',
      module: 'brain',
      system: 'Answer with a JSON array only, no prose.',
      messages: [
        {
          role: 'user',
          content:
            `Hubs:\n${hubs.map((h) => `- ${h.slug} (${h.name}): ${h.keywords.join(', ')}`).join('\n')}\n\n` +
            `Notes:\n${notes.map((n) => `- ${n.id}: ${n.title}\n${n.body}`).join('\n\n')}\n\n` +
            `File each note into any hub it fits. Reply with JSON: ` +
            `[{ "note_id": "...", "hub_slug": "...", "confidence": 0.0 }]`,
        },
      ],
    })
  } catch (err) {
    if (err instanceof SoftCapExceeded || err instanceof NotConnected) {
      return { filed: 0, reason: err.message }
    }
    throw err
  }

  const knownNotes = new Set(notes.map((n) => n.id))
  const hubBySlug = new Map(hubs.map((h) => [h.slug, h.id]))

  let hits: ModelHit[]
  try {
    const cleaned = reply.replace(/^```json\s*/i, '').replace(/```\s*$/, '')
    hits = JSON.parse(cleaned)
  } catch {
    return { filed: 0, reason: 'Model reply was not valid JSON.' }
  }

  let filed = 0
  for (const hit of hits) {
    if (!knownNotes.has(hit.note_id)) continue
    const hubId = hubBySlug.get(hit.hub_slug)
    if (!hubId) continue
    const raw = Number(hit.confidence)
    const confidence = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.5

    await db().query(
      `insert into brain.note_hub (note_id, hub_id, confidence, classified_by)
       values ($1, $2, $3, 'model')
       on conflict do nothing`,
      [hit.note_id, hubId, confidence],
    )
    filed++
  }

  return { filed }
}
