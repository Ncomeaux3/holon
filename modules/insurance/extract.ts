import { complete, NotConnected } from '@/core/llm'
import { upload, remove, type StoredFile } from '@/core/files'
import { FIELDS, parseFields, type DraftField } from './draft'

// Drafting a policy from a declarations page. Nothing here writes a policy: it
// returns fields for the owner to confirm, each with the model's confidence,
// and the screen marks the shaky ones.

export type Draft = {
  file: StoredFile
  fileName: string
  fields: DraftField[]
}

const SYSTEM = `You read an insurance declarations page and copy what it says into fields.

Copy. Do not interpret, do not convert, do not summarise, and never judge whether the cover is adequate: that is not your job and nobody asked.

Return JSON only, an array of {"key","value","confidence"} objects, one per field asked for. Confidence is 0 to 1 and is how sure you are that the value is on the page. If a field is not on the page, return an empty value and a confidence of 0 rather than a guess.`

/**
 * Send the PDF to the model and get fields back.
 *
 * The PDF goes to Anthropic as a document block: no local PDF parser, and no
 * new dependency for the one thing the model already does. The file is stored
 * in the module's private bucket first because that is where it will live if
 * the draft is accepted, and `discard` removes it if it is not. No policy row
 * exists until the owner presses Create.
 */
export async function draftFromPdf(fileName: string, bytes: Buffer): Promise<Draft> {
  const stored = await upload(
    'insurance',
    `drafts/${Date.now()}-${fileName.replace(/[^A-Za-z0-9._-]/g, '_')}`,
    bytes,
    'application/pdf',
  )

  let text: string
  try {
    text = await complete({
      // Haiku: this is copying text out of a page, which is the cheapest thing
      // a model does, and the owner confirms every field anyway.
      model: 'claude-haiku-4-5',
      purpose: 'classification',
      module: 'insurance',
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: bytes.toString('base64'),
              },
            },
            {
              type: 'text',
              text: `Fields:\n${FIELDS.map((f) => `- ${f.key}: ${f.hint}`).join('\n')}`,
            },
          ],
        },
      ],
    })
  } catch (error) {
    // The file is not left behind when the call never produced anything.
    await remove(stored)
    if (error instanceof NotConnected) {
      throw new Error(
        'Anthropic is not connected, so a PDF cannot be read. Connect it on Settings > Connections, or type the policy in by hand.',
      )
    }
    throw error
  }

  return { file: stored, fileName, fields: parseFields(text) }
}

