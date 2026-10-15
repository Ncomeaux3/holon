import { describe, expect, it } from 'vitest'

import { decodeEntities, extract, extractText, extractTitle, looksEmpty } from './extract'

// Hand rolled extraction, by decision, because the module shows the extracted
// text beside the draft: a bad extraction is visible and correctable rather
// than silent. These tests pin the cases that decide whether a summary is
// written about the article or about the navigation menu.

describe('decodeEntities', () => {
  it('decodes the named ones that actually appear in prose', () => {
    expect(decodeEntities('Fish &amp; chips')).toBe('Fish & chips')
    expect(decodeEntities('a&nbsp;b')).toBe('a b')
    expect(decodeEntities('&ldquo;quoted&rdquo;')).toBe('"quoted"')
  })

  it('decodes numeric and hex references', () => {
    expect(decodeEntities('&#39;')).toBe("'")
    expect(decodeEntities('caf&#xe9;')).toBe('café')
  })

  // Decoding twice turns &amp;lt; into <, which is how a quoted code sample
  // becomes a tag and then disappears in the next strip.
  it('decodes once, not repeatedly', () => {
    expect(decodeEntities('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;')
  })

  it('leaves an unknown entity alone rather than eating it', () => {
    expect(decodeEntities('&notarealentity;')).toBe('&notarealentity;')
  })

  it('does not throw on a malformed reference', () => {
    expect(() => decodeEntities('&#999999999999;')).not.toThrow()
  })
})

describe('extractText', () => {
  it('drops script and style contents rather than reading them as prose', () => {
    const html = `<body><script>var x = "buy now";</script><style>.a{color:red}</style>
      <p>The actual article text.</p></body>`
    const text = extractText(html)
    expect(text).toContain('The actual article text.')
    expect(text).not.toContain('buy now')
    expect(text).not.toContain('color:red')
  })

  it('prefers the article container over the chrome around it', () => {
    const html = `<body>
      <nav>Home About Contact Subscribe</nav>
      <article><p>${'Real prose about distributed systems. '.repeat(10)}</p></article>
      <footer>Copyright 2026</footer>
    </body>`
    const text = extractText(html)
    expect(text).toContain('distributed systems')
    expect(text).not.toContain('Subscribe')
    expect(text).not.toContain('Copyright')
  })

  // An index page has many <article> tags, one per card. The one worth reading
  // is the biggest, not the first.
  it('takes the largest article when a page lists several', () => {
    const html = `<body>
      <article><p>Teaser one.</p></article>
      <article><p>${'The full piece runs on for a while. '.repeat(20)}</p></article>
    </body>`
    expect(extractText(html)).toContain('The full piece runs on')
  })

  it('strips chrome when the page names no article container', () => {
    const html = `<body><nav>Menu Login</nav><div><p>Body text here.</p></div></body>`
    const text = extractText(html)
    expect(text).toContain('Body text here.')
    expect(text).not.toContain('Login')
  })

  it('turns block tags into line breaks so paragraphs survive', () => {
    const html = '<body><p>First para.</p><p>Second para.</p></body>'
    expect(extractText(html)).toBe('First para.\n\nSecond para.')
  })

  it('collapses the whitespace HTML is full of', () => {
    const html = '<body><p>Lots     of\n\n\n   space</p></body>'
    expect(extractText(html)).toBe('Lots of space')
  })

  it('does not leave tag fragments in the text', () => {
    const html = '<body><p>Text with <a href="/x" title="a > b">a link</a> inside.</p></body>'
    const text = extractText(html)
    expect(text).not.toMatch(/[<>]/)
    expect(text).toContain('a link')
  })

  it('drops HTML comments', () => {
    expect(extractText('<body><!-- tracking pixel --><p>Prose.</p></body>')).toBe('Prose.')
  })
})

describe('extractTitle', () => {
  it('prefers og:title, which is written for humans', () => {
    const html = `<head><meta property="og:title" content="The Real Headline">
      <title>The Real Headline | Some Publication</title></head>`
    expect(extractTitle(html)).toBe('The Real Headline')
  })

  it('strips the publication off a title tag', () => {
    expect(extractTitle('<title>Replication Explained | The Morning Paper</title>')).toBe(
      'Replication Explained',
    )
  })

  // A headline can legitimately contain a dash, and cutting at the first one
  // would truncate it. Only a short trailing segment is a publication.
  it('keeps a headline that contains a dash', () => {
    expect(extractTitle('<title>Postgres - what the planner actually does</title>')).toBe(
      'Postgres - what the planner actually does',
    )
  })

  it('falls back to h1, then to nothing', () => {
    expect(extractTitle('<body><h1>Just an <em>h1</em></h1></body>')).toBe('Just an h1')
    expect(extractTitle('<body><p>No title anywhere.</p></body>')).toBe('')
  })
})

// The most important guard in the file. Summarising a paywall stub produces a
// confident note about an article nobody read.
describe('looksEmpty', () => {
  it('catches a paywall stub', () => {
    const html = `<body><article><p>Subscribe to continue reading.</p></article></body>`
    expect(looksEmpty(extractText(html))).toBe(true)
  })

  it('catches a page that is all whitespace', () => {
    expect(looksEmpty('   \n\n   \t  ')).toBe(true)
  })

  it('passes a real article', () => {
    const text = 'Sentence about the subject. '.repeat(30)
    expect(looksEmpty(text)).toBe(false)
  })
})

describe('extract', () => {
  it('returns a title and text together', () => {
    const html = `<html><head><title>A Piece | Blog</title></head>
      <body><article><p>${'Words that go on for a bit. '.repeat(20)}</p></article></body></html>`
    const { title, text } = extract(html)
    expect(title).toBe('A Piece')
    expect(text).toContain('Words that go on')
  })
})
