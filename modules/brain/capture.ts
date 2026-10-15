import type Anthropic from '@anthropic-ai/sdk'
import { db } from '@/core/db'
import { register } from '@/core/entities'
import { download, upload } from '@/core/files'
import { NotConnected, SoftCapExceeded, complete } from '@/core/llm'
import { embedChanged } from '@/core/search'
import { resolveDanglingLinks, syncLinks, uniqueSlug } from './data'
import { fileByRules } from './hubs'

// One capture box, no title field. The first line is the title because that
// is what people write first anyway; asking for a title separately is the
// friction that keeps a thought out of the vault.

export type Captured = { id: string; slug: string; status: 'draft' | 'published' }

/**
 * Save typed text as a note. A "worked on" entry is kind `daily`, not a new
 * kind: a log line and a daily note are the same thing at different lengths.
 *
 * The status rule is the one `write` applies: an agent drafts, the owner
 * publishes.
 */
export async function captureText(
  { text, worked = false }: { text: string; worked?: boolean },
  source: 'manual' | 'agent' = 'manual',
): Promise<Captured> {
  const trimmed = text.trim()
  const newline = trimmed.indexOf('\n')
  const first = (newline === -1 ? trimmed : trimmed.slice(0, newline)).trim()
  const title = first.slice(0, 120) || 'Untitled'
  // One line is both the title and the body, so the note is not empty.
  const body = newline === -1 ? trimmed : trimmed.slice(newline + 1).trim()

  const status = source === 'agent' ? 'draft' : 'published'
  const slug = await uniqueSlug(title)

  const { rows } = await db().query<{ id: string }>(
    `insert into brain.note (title, body, slug, kind, status, source)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [title, body, slug, worked ? 'daily' : 'note', status, source],
  )
  const id = rows[0].id

  await syncLinks(id, body)
  await resolveDanglingLinks(slug, id)
  await register({
    module: 'brain',
    entityType: 'note',
    entityId: id,
    title,
    text: body,
    eventType: status === 'draft' ? 'note_ingested' : undefined,
  })
  await fileByRules(id, title, body)
  // Now rather than at the nightly run, so the note can show up as related
  // to the next thing typed.
  await embedChanged()

  return { id, slug, status }
}

/** The body of a file note the cap or a missing key stopped. `transcribePending` finds it by this line. */
export const PENDING = 'Transcription pending'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
type ImageType = (typeof IMAGE_TYPES)[number]
type FileType = 'application/pdf' | ImageType
// ponytail: 10 MB and one call per file; chunk PDFs by page if a large one ever matters.
const MAX_BYTES = 10 * 1024 * 1024

function fileType(type: string): FileType {
  if (type === 'application/pdf' || (IMAGE_TYPES as readonly string[]).includes(type)) return type as FileType
  throw new Error('Only a PDF or a JPEG, PNG, GIF or WebP image can be captured')
}

/**
 * Every word the model can read, or the pending line when it could not be
 * asked. Anything else thrown is a real failure and stays thrown.
 */
async function transcribe(type: FileType, bytes: Buffer): Promise<string> {
  const data = bytes.toString('base64')
  const block: Anthropic.ContentBlockParam =
    type === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: type, data } }
      : { type: 'image', source: { type: 'base64', media_type: type, data } }
  try {
    return await complete({
      model: 'claude-haiku-4-5',
      purpose: 'summary',
      module: 'brain',
      system: 'Transcribe every word you can read. No commentary.',
      messages: [{ role: 'user', content: [block] }],
    })
  } catch (err) {
    if (err instanceof SoftCapExceeded || err instanceof NotConnected) return PENDING
    throw err
  }
}

async function setBody(id: string, title: string, body: string): Promise<void> {
  await db().query(`update brain.note set body = $2 where id = $1`, [id, body])
  await fileByRules(id, title, body)
  await embedChanged()
}

/**
 * A file is a note with `file_path` set: the file name is the title and the
 * transcription is the body, so it searches and files like anything typed.
 */
export async function captureFile({
  name,
  type,
  bytes,
}: {
  name: string
  type: string
  bytes: Buffer
}): Promise<Captured> {
  const accepted = fileType(type)
  if (bytes.byteLength > MAX_BYTES) throw new Error('Files over 10 MB are not captured')

  const title = name.slice(0, 120) || 'Untitled'
  const slug = await uniqueSlug(title)
  const { rows } = await db().query<{ id: string }>(
    `insert into brain.note (title, body, slug, kind, status, source)
     values ($1, '', $2, 'note', 'published', 'manual')
     returning id`,
    [title, slug],
  )
  const id = rows[0].id

  const stored = await upload('brain', `${id}/${name.replace(/[^A-Za-z0-9._-]/g, '_')}`, bytes, accepted)
  await db().query(`update brain.note set file_path = $2 where id = $1`, [id, stored.path])
  await register({ module: 'brain', entityType: 'note', entityId: id, title, text: '' })

  await setBody(id, title, await transcribe(accepted, bytes))
  return { id, slug, status: 'published' }
}

/**
 * One file a night whose transcription the cap stopped, read back from the
 * bucket. One, so a cap that is still in force is not hit twice.
 */
export async function transcribePending(): Promise<{ transcribed: number }> {
  const { rows } = await db().query<{ id: string; title: string; file_path: string }>(
    `select id, title, file_path from brain.note
      where file_path <> '' and body = $1
      order by created_at
      limit 1`,
    [PENDING],
  )
  const note = rows[0]
  if (!note) return { transcribed: 0 }

  const blob = await download({ module: 'brain', path: note.file_path })
  const body = await transcribe(fileType(blob.type), Buffer.from(await blob.arrayBuffer()))
  if (body === PENDING) return { transcribed: 0 }

  await setBody(note.id, note.title, body)
  return { transcribed: 1 }
}
