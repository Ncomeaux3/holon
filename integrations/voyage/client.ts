import { getCredentials } from '@/core/credentials'



/**
 * voyage-4-lite at its default 1024 dimensions, matching vector(1024) in
 * core.embeddings. $0.02 per million tokens with 200M free (verified
 * 2026-09-05). core/search.ts batches into this nightly.
 */
export const VOYAGE_MODEL = 'voyage-4-lite'
export const VOYAGE_DIMENSIONS = 1024

const ENDPOINT = 'https://api.voyageai.com/v1/embeddings'

export type InputType = 'document' | 'query'

export async function embed(
  texts: string[],
  inputType: InputType = 'document',
  apiKey?: string,
): Promise<number[][]> {
  if (texts.length === 0) return []

  const key = apiKey ?? (await getCredentials('voyage'))?.api_key
  if (!key) throw new Error('Voyage is not connected. Connect it on Settings > Connections.')

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: texts,
      model: VOYAGE_MODEL,
      input_type: inputType,
      output_dimension: VOYAGE_DIMENSIONS,
    }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    throw new Error(`Voyage ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }

  const body = (await res.json()) as { data: { embedding: number[]; index: number }[] }
  // The API may not preserve order, so index explicitly rather than assuming.
  const out: number[][] = new Array(texts.length)
  for (const row of body.data) out[row.index] = row.embedding
  return out
}
