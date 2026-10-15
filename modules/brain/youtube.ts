import { decodeEntities } from './extract'
import { get } from '@/core/fetching'

// YouTube transcripts without yt-dlp.
//
// SPEC says yt-dlp. It is a Python binary and Vercel's Node runtime cannot run
// one, so the choice was never between this and yt-dlp: it was between this and
// nothing. What this does instead is what yt-dlp does for captions anyway,
// which is read the caption track list off the watch page and fetch a track.
//
// The endpoint is undocumented and can change. Everything here fails by
// returning null with a reason rather than throwing, and the caller says the
// transcript could not be read instead of writing a note about a video nobody
// watched.

/**
 * The video id out of any of the URL shapes YouTube uses.
 *
 * Returns null for a URL that is not a video, including a channel or a playlist
 * page, so the caller falls through to ordinary article extraction rather than
 * asking for captions that cannot exist.
 */
export function videoId(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const host = parsed.hostname.replace(/^www\./, '')
  const id =
    host === 'youtu.be'
      ? parsed.pathname.slice(1)
      : host.endsWith('youtube.com')
        ? (parsed.searchParams.get('v') ??
          parsed.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)?.[1])
        : null

  // Eleven characters from a known alphabet. Checked because the id is
  // interpolated into a URL, and because a malformed one otherwise becomes a
  // request that returns a page rather than an error.
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
}

export function isYouTube(url: string): boolean {
  return videoId(url) !== null
}

type CaptionTrack = { baseUrl: string; languageCode?: string; kind?: string }

/**
 * Caption tracks named in a watch page.
 *
 * The page carries a large JSON blob and the tracks sit inside it. Finding the
 * array by its key and parsing from the opening bracket is deliberate: parsing
 * the whole blob means matching braces through megabytes of minified JSON to
 * find where it ends, and the array is self-delimiting.
 */
export function captionTracks(watchPageHtml: string): CaptionTrack[] {
  const start = watchPageHtml.indexOf('"captionTracks":')
  if (start === -1) return []

  const open = watchPageHtml.indexOf('[', start)
  if (open === -1) return []

  // Depth counting rather than a regex: a caption track's name can contain a
  // bracket, and stopping at the first `]` would cut the array in half.
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = open; i < watchPageHtml.length; i++) {
    const c = watchPageHtml[i]

    if (escaped) {
      escaped = false
      continue
    }
    if (c === '\\') {
      escaped = true
      continue
    }
    if (c === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) {
        try {
          const parsed = JSON.parse(watchPageHtml.slice(open, i + 1))
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      }
    }
  }

  return []
}

/**
 * The track to read.
 *
 * A manually written track beats an automatic one: `kind: 'asr'` is speech
 * recognition and is materially worse, so it is the fallback rather than
 * whatever happens to be first. English is preferred only as a tiebreak, and
 * any track is better than none.
 */
export function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) return null
  const score = (t: CaptionTrack) =>
    (t.kind === 'asr' ? 0 : 2) + (t.languageCode?.startsWith('en') ? 1 : 0)
  return tracks.reduce((best, t) => (score(t) > score(best) ? t : best))
}

/**
 * Caption XML into readable prose.
 *
 * Captions arrive as timed fragments broken at display width, not at sentence
 * boundaries, so joining them with spaces is what turns a subtitle file back
 * into something a model can summarise and a person can read.
 */
export function transcriptFromXml(xml: string): string {
  const texts = [...xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1])

  return (
    texts
      .map((t) =>
        // Captions are double encoded: the XML carries `&amp;#39;` for an
        // apostrophe. One decode leaves `&#39;` visible in the note, so this is
        // the one place two passes is right rather than a bug.
        decodeEntities(decodeEntities(t))
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** What the ingest asks for. Null means say so, never guess. */
export type Transcript = { text: string; language: string; automatic: boolean }

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export async function fetchTranscript(id: string): Promise<Transcript | null> {
  // Through the pinned fetcher like everything else. The caption URL below is
  // taken out of a page's own JSON rather than typed by the owner, which is a
  // shorter leash than a pasted link but not a reason to skip the checks.
  const page = await get(`https://www.youtube.com/watch?v=${id}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
    timeoutMs: 20_000,
  })
  if (page.status !== 200) return null

  const track = pickTrack(captionTracks(page.body))
  if (!track?.baseUrl) return null

  const captions = await get(track.baseUrl, {
    headers: { 'User-Agent': UA },
    timeoutMs: 20_000,
  })
  if (captions.status !== 200) return null

  const text = transcriptFromXml(captions.body)
  if (text.length === 0) return null

  return {
    text,
    language: track.languageCode ?? 'unknown',
    automatic: track.kind === 'asr',
  }
}

/** The title, from the watch page's og:title. */
export function videoTitle(watchPageHtml: string): string {
  const og = watchPageHtml.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i,
  )?.[1]
  return og ? decodeEntities(og).trim() : ''
}
