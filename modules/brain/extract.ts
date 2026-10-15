// HTML to readable text. No parser dependency, by decision: the module shows
// the extracted text beside the draft, so a bad extraction is visible and
// correctable rather than silent, which is a much lower bar than a library has
// to clear. It also keeps the serverless bundle small and works anywhere.
//
// This is not Readability's algorithm and does not pretend to be. It is the
// four things that account for most of the difference on a normal article:
// drop what is definitionally not prose, prefer the tag that says "this is the
// article", turn block tags into line breaks, and decode entities.

/** Elements whose contents are never prose. Dropped with their contents. */
const DROP = /<(script|style|noscript|svg|iframe|template|form|button|select)\b[^>]*>[\s\S]*?<\/\1>/gi

/** Chrome. Dropped with contents, but only outside the article container. */
const CHROME = /<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi

/** Tags that end a line when they close. */
const BLOCK = /<\/(p|div|section|article|h[1-6]|li|tr|blockquote|pre|figcaption)\s*>/gi

/**
 * A tag, including one whose attributes contain a bare `>`.
 *
 * `<[^>]+>` is the obvious version and it is wrong: `<a title="a > b">` ends
 * the match at the `>` inside the quotes, leaving `b">` behind as text in the
 * note. Quoted runs are consumed explicitly so the match ends at the real
 * closing bracket. A lone `<` in prose still matches nothing and stays put.
 */
const TAG = /<[a-zA-Z!/?][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '-',
  ndash: '-',
  hellip: '...',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  middot: '.',
}

/**
 * HTML entities to the characters they mean.
 *
 * Left encoded, `&amp;` survives into the note and into the summary prompt,
 * where the model reproduces it. One pass, not repeated: decoding twice turns
 * `&amp;lt;` into `<`, which is how a quoted code sample becomes a tag.
 */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (whole, name) => NAMED[name.toLowerCase()] ?? whole)
}

function safeCodePoint(code: number): string {
  // A malformed reference should not throw and take the whole ingest with it.
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ''
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

/**
 * The article's own container, when the page names one.
 *
 * `<article>` then `<main>`, because a page that uses either is telling us
 * where the prose is and that beats any heuristic. Only the largest match is
 * taken: a page listing article cards has many `<article>` tags and the one
 * worth reading is the biggest.
 */
function articleBody(html: string): string | null {
  for (const tag of ['article', 'main']) {
    const matches = [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))]
    if (matches.length === 0) continue
    const largest = matches.reduce((a, b) => (b[1].length > a[1].length ? b : a))
    // A container that holds almost nothing is a stub, not the article.
    if (largest[1].length > 200) return largest[1]
  }
  return null
}

/**
 * The page's title.
 *
 * og:title first: it is the one a publisher writes for humans, without the
 * " | Site Name" that `<title>` almost always carries.
 */
export function extractTitle(html: string): string {
  const og = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
  )?.[1]
  if (og) return decodeEntities(og).trim()

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  if (title) {
    // "Headline | The Publication" is the near-universal shape, and the
    // publication is not part of the headline.
    // A plain hyphen is deliberately not a separator. "Postgres - what the
    // planner actually does" is one headline, and treating the hyphen as a
    // separator truncates it to one word. The characters below are used as
    // separators and almost never appear inside a headline; the hyphen is the
    // opposite, so it is left alone and such a title keeps its tail.
    return decodeEntities(title)
      .replace(/\s*[|\u00bb\u00b7\u2013\u2014]\s*[^|\u00bb\u00b7\u2013\u2014]{1,40}$/, '')
      .trim()
  }

  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  return h1 ? decodeEntities(h1.replace(/<[^>]+>/g, '')).trim() : ''
}

/**
 * Readable text out of an HTML page.
 *
 * Order matters: script and style go first so their contents cannot be mistaken
 * for prose, then the article container is chosen, and chrome is only stripped
 * when no container was found. Stripping `<nav>` inside a chosen `<article>`
 * would be right too, but it is not worth the pass: a publisher who marks up an
 * article does not usually put the site nav inside it.
 */
export function extractText(html: string): string {
  const withoutScripts = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(DROP, ' ')

  const body = articleBody(withoutScripts) ?? withoutScripts.replace(CHROME, ' ')

  return (
    body
      // Every whitespace run becomes one space first, so the only line breaks
      // left are the ones tags put there. Without this a newline inside a
      // paragraph splits it and an article arrives as one line per source line
      // rather than one per paragraph. It also matches how a browser renders:
      // whitespace outside <pre> is not significant.
      .replace(/\s+/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(BLOCK, '\n\n')
      .replace(TAG, ' ')
      .split('\n')
      // Entities decode last. Decoding first would turn &lt;p&gt; into a tag
      // and the strip above would then eat a quoted code sample.
      .map((line) => decodeEntities(line).replace(/ +/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

export type Extracted = { title: string; text: string }

export function extract(html: string): Extracted {
  return { title: extractTitle(html), text: extractText(html) }
}

/**
 * Whether what came back is worth summarising.
 *
 * A paywall stub, a cookie wall and a JavaScript-only page all return a page
 * with almost no prose in it. Summarising one produces a confident note about
 * an article nobody read, which is the single worst thing this feature could
 * do, so the caller stops and says what it got instead.
 */
export function looksEmpty(text: string): boolean {
  return text.replace(/\s+/g, ' ').trim().length < 400
}
