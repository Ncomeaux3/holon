import { complete, NotConnected, SoftCapExceeded } from '@/core/llm'
import { extract, looksEmpty } from './extract'
import { get, normaliseUrl } from '@/core/fetching'
import { fetchTranscript, isYouTube, videoId, videoTitle } from './youtube'

// The outbound checks and the pinned connection live in ./fetching. Re-exported
// because they are part of this module's surface and several callers reach for
// them by name.
export { isPrivateHost, normaliseUrl, Refused } from '@/core/fetching'

// SPEC section 6's ingestion: a URL becomes readable text, a YouTube link
// becomes a transcript, and the model drafts a summary the owner approves.
//
// Nothing here writes a note. It returns what it found, and the caller hands
// that to the module's own `write` tool, which produces a draft because that is
// what `write` does. The review step stays exactly where it was.

export type Ingested = {
  title: string
  /** The drafted summary, or empty when there is no model to draft one. */
  summary: string
  /** What the summary was drawn from. Stored and shown beside it. */
  sourceText: string
  sourceUrl: string
  kind: 'article' | 'video'
  /** One line for the owner about anything that did not go to plan. */
  note: string
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Enough for a long article. Past this the tail is navigation and comments. */
const MAX_SOURCE_CHARS = 60_000

/** A page larger than this is not an article. Guards against a huge download. */
const MAX_BYTES = 5_000_000

const SYSTEM = `You summarise something the reader has decided to keep, for their own notes.

Write markdown. Open with two or three sentences on what it actually says, then the specific points worth remembering as bullets. Prefer the concrete: a number, a name, a claim someone made.

Rules:
- Only what the text says. If it does not say something, do not supply it from what you know.
- No preamble, no "this article discusses", no closing summary of your summary.
- Keep the author's own terms rather than translating them into general ones.
- If the text is truncated or clearly incomplete, say so in one line at the end.`

/**
 * Fetch a URL and return what it holds.
 *
 * Throws only for a failure the owner has to see: an unreachable page, or a
 * page that turned out to hold nothing worth summarising. Everything softer
 * comes back in `note` alongside a usable result.
 */
export async function ingestUrl(rawUrl: string): Promise<Ingested> {
  const url = normaliseUrl(rawUrl)
  return isYouTube(url) ? ingestVideo(url) : ingestArticle(url)
}

async function fetchText(url: string): Promise<string> {
  const res = await get(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    maxBytes: MAX_BYTES,
  })

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`That page answered ${res.status}.`)
  }
  if (res.contentType && !/text\/html|text\/plain|application\/xhtml/i.test(res.contentType)) {
    throw new Error(`That is a ${res.contentType.split(';')[0]}, not a page. Nothing to read.`)
  }

  return res.body
}

async function ingestArticle(url: string): Promise<Ingested> {
  const { title, text } = extract(await fetchText(url))

  // A paywall stub, a cookie wall and a JavaScript-only page all look like
  // this. Summarising one produces a confident note about something nobody
  // read, which is the worst thing this feature could do.
  if (looksEmpty(text)) {
    throw new Error(
      'That page had almost no text in it. It may be paywalled, or it may render in the browser. Paste the text in by hand instead.',
    )
  }

  const source = text.slice(0, MAX_SOURCE_CHARS)
  const drafted = await summarise(title || url, source)

  return {
    title: title || url,
    summary: drafted.summary,
    sourceText: source,
    sourceUrl: url,
    kind: 'article',
    note: [text.length > MAX_SOURCE_CHARS ? 'The article was long and was trimmed.' : '', drafted.note]
      .filter(Boolean)
      .join(' '),
  }
}

async function ingestVideo(url: string): Promise<Ingested> {
  const id = videoId(url)!
  const transcript = await fetchTranscript(id)

  if (!transcript) {
    throw new Error(
      'That video has no captions this can read. YouTube only exposes a transcript when captions exist, and some videos have none.',
    )
  }

  // The watch page is fetched a second time for the title. One extra request
  // against a page already warm in YouTube's cache, versus threading the title
  // back through a function whose job is captions.
  let title = ''
  try {
    title = videoTitle(await fetchText(url))
  } catch {
    // A title is a nicety. A transcript is the thing.
  }

  const source = transcript.text.slice(0, MAX_SOURCE_CHARS)
  const drafted = await summarise(title || url, source)

  return {
    title: title || `YouTube ${id}`,
    summary: drafted.summary,
    sourceText: source,
    sourceUrl: url,
    kind: 'video',
    note: [
      transcript.automatic
        ? "The transcript is YouTube's automatic one, so names and terms may be wrong."
        : '',
      transcript.text.length > MAX_SOURCE_CHARS ? 'The transcript was long and was trimmed.' : '',
      drafted.note,
    ]
      .filter(Boolean)
      .join(' '),
  }
}

/**
 * The draft.
 *
 * Haiku, and capped: this is owner-initiated and optional enough to stop. A
 * summary that cannot be written is not a failure, because the draft still
 * arrives with the full source text on it and the owner can write the note
 * themselves. That is what a second brain is for.
 */
async function summarise(title: string, text: string): Promise<{ summary: string; note: string }> {
  try {
    const summary = await complete({
      model: 'claude-haiku-4-5',
      purpose: 'summary',
      module: 'brain',
      system: SYSTEM,
      messages: [{ role: 'user', content: `Title: ${title}\n\n${text}` }],
      maxTokens: 1500,
    })
    return { summary: summary.trim(), note: '' }
  } catch (error) {
    if (error instanceof SoftCapExceeded) {
      return { summary: '', note: 'No summary: the model spend cap has been reached this month.' }
    }
    if (error instanceof NotConnected) {
      return { summary: '', note: 'No summary: Anthropic is not connected.' }
    }
    return { summary: '', note: 'No summary: the model could not be reached.' }
  }
}
