'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/core/auth'
import { db } from '@/core/db'
import { signedUrl } from '@/core/files'
import { callTool, ToolInputError } from '@/core/tools'
import { captureFile as captureFileNote } from '../capture'
import { refileByRules, setHubs } from '../hubs'
import { relatedTo, relatedToText, type Related } from '../related'
import { slugify } from '../wikilinks'

// Server actions are standalone POST endpoints addressed by id, so the (app)
// layout does not run for them and each one authenticates independently.

export type ActionResult = { ok: true } | { ok: false; error: string; fields?: Record<string, string> }

function failed(error: unknown): ActionResult {
  return {
    ok: false,
    error: error instanceof Error ? error.message : 'Failed',
    ...(error instanceof ToolInputError && { fields: error.fields }),
  }
}

function done(): ActionResult {
  revalidatePath('/brain')
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function saveNote(input: {
  id?: string
  title?: string
  body?: string
  kind?: string
}): Promise<ActionResult & { slug?: string }> {
  await requireOwner()
  try {
    const call = await callTool('brain', 'write', input, { source: 'ui' })
    const slug = call.status === 'done' ? (call.result as { slug?: string }).slug : undefined
    return { ...done(), slug }
  } catch (error) {
    return failed(error)
  }
}

/** Discard a draft. Guarded like every delete; from the UI the owner is the approval. */
export async function deleteNote(id: string): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('brain', 'delete', { id }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

/**
 * Read a URL and draft a note from it.
 *
 * `source: 'ui'` is the approval: `ingest` is guarded because it spends money,
 * and a guarded tool called from the UI is the owner pressing the button. The
 * same tool called by an agent lands in the Review inbox instead.
 *
 * Returns the note it made so the screen can open it, and the ingest's own note
 * about anything that did not go to plan: an automatic transcript, a trimmed
 * article, a summary that could not be written because the cap was reached.
 */
export async function ingestFromUrl(
  url: string,
  kind?: string,
): Promise<ActionResult & { id?: string; slug?: string; note?: string }> {
  await requireOwner()
  try {
    const call = await callTool('brain', 'ingest', { url, kind }, { source: 'ui' })
    // A UI call is pre-approved, so this is always 'done'. Handled rather than
    // asserted, because the day the guard changes this should not silently
    // report success for a note that does not exist yet.
    if (call.status === 'proposed') {
      return { ...done(), note: 'That went to the Review inbox for approval.' }
    }
    const result = call.result as { id: string; slug: string; note: string }
    return { ...done(), id: result.id, slug: result.slug, note: result.note }
  } catch (error) {
    return failed(error)
  }
}

/** Accept a draft into the vault, or send a note back to the inbox. */
export async function publishNote(id: string, publish: boolean): Promise<ActionResult> {
  await requireOwner()
  try {
    await callTool('brain', 'publish', { id, publish }, { source: 'ui' })
    return done()
  } catch (error) {
    return failed(error)
  }
}

/**
 * Start the note a dangling link points at, with the link's own slug as its
 * title. Writing it is what connects the two, and the nightly job would do the
 * same resolution anyway.
 */
export async function startFromLink(slug: string): Promise<ActionResult> {
  await requireOwner()
  try {
    const title = slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())
    await callTool(
      'brain',
      'write',
      { title, body: `Started from a link in another note.\n` },
      { source: 'ui' },
    )
    return done()
  } catch (error) {
    return failed(error)
  }
}

/** Save the capture box. First line is the title; `worked` files it as a daily. */
export async function captureText(input: {
  text: string
  worked?: boolean
}): Promise<ActionResult & { slug?: string }> {
  await requireOwner()
  try {
    const call = await callTool('brain', 'capture', input, { source: 'ui' })
    const slug = call.status === 'done' ? (call.result as { slug?: string }).slug : undefined
    return { ...done(), slug }
  } catch (error) {
    return failed(error)
  }
}

/** Attach a PDF or an image from the capture box. The transcription is the note's body. */
export async function captureFile(form: FormData): Promise<ActionResult & { slug?: string }> {
  await requireOwner()
  try {
    const file = form.get('file')
    if (!(file instanceof File)) throw new Error('No file was sent')
    const { slug } = await captureFileNote({
      name: file.name,
      type: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    })
    return { ...done(), slug }
  } catch (error) {
    return failed(error)
  }
}

/** A short lived URL for the file behind a note. Nothing in the bucket is public. */
export async function noteFileUrl(noteId: string): Promise<{ ok: true; url: string } | { ok: false; error: string; fields?: Record<string, string> }> {
  await requireOwner()
  try {
    const { rows } = await db().query<{ file_path: string }>(`select file_path from brain.note where id = $1`, [noteId])
    if (!rows[0]?.file_path) throw new Error('This note has no file behind it')
    return { ok: true, url: await signedUrl({ module: 'brain', path: rows[0].file_path }) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' }
  }
}

/** Notes near what is being typed. A read, so nothing is revalidated. */
export async function relatedForDraft(text: string): Promise<ActionResult & { related?: Related[] }> {
  await requireOwner()
  try {
    return { ok: true, related: await relatedToText(text) }
  } catch (error) {
    return failed(error)
  }
}

/** Notes near an open one, by embedding. Empty until the note has a vector. */
export async function relatedForNote(noteId: string): Promise<ActionResult & { related?: Related[] }> {
  await requireOwner()
  try {
    return { ok: true, related: await relatedTo(noteId) }
  } catch (error) {
    return failed(error)
  }
}

/**
 * Make or rename a hub. The slug is set once, on create, so a `hub:<slug>`
 * folder in the URL survives a rename. Notes still unfiled are re-run against
 * the new keywords straight away.
 */
export async function saveHub(input: { id?: string; name: string; keywords: string[] }): Promise<ActionResult> {
  await requireOwner()
  try {
    const name = input.name.trim()
    const keywords = input.keywords.map((k) => k.trim()).filter(Boolean)
    if (!name) return { ok: false, error: 'A hub needs a name.' }
    let id = input.id
    if (id) {
      await db().query(`update brain.hub set name = $2, keywords = $3 where id = $1`, [id, name, keywords])
    } else {
      const { rows } = await db().query<{ id: string }>(
        `insert into brain.hub (name, slug, keywords) values ($1, $2, $3) returning id`,
        [name, slugify(name), keywords],
      )
      id = rows[0].id
    }
    await refileByRules(id)
    return done()
  } catch (error) {
    // The slug is unique, so a second hub with the same name lands here.
    if ((error as { code?: string }).code === '23505') return { ok: false, error: 'A hub with that name exists.' }
    return failed(error)
  }
}

/** The owner's own filing of one note. Wins over rules and the model. */
export async function setNoteHubs(noteId: string, hubIds: string[]): Promise<ActionResult> {
  await requireOwner()
  try {
    await setHubs(noteId, hubIds)
    return done()
  } catch (error) {
    return failed(error)
  }
}
