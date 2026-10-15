import { describe, expect, it } from 'vitest'
import { blocks, extractLinks, slugify, renderPreview } from './wikilinks'

// A vault's links are its structure. Getting the parser wrong does not throw,
// it quietly loses the connection between two notes, which is the one thing a
// second brain exists to keep.

describe('slugify', () => {
  it('makes a stable file name from a title', () => {
    expect(slugify('Reciprocal rank fusion for hybrid search')).toBe(
      'reciprocal-rank-fusion-for-hybrid-search',
    )
  })

  it('collapses punctuation rather than encoding it', () => {
    expect(slugify('DDIA · ch. 5: Replication')).toBe('ddia-ch-5-replication')
    expect(slugify('What  about   spaces?')).toBe('what-about-spaces')
  })

  it('never starts or ends with a separator', () => {
    expect(slugify('  ...Leading and trailing!  ')).toBe('leading-and-trailing')
  })

  it('keeps a long title usable as a file name', () => {
    const slug = slugify('a'.repeat(200))
    expect(slug.length).toBeLessThanOrEqual(80)
  })

  it('gives an untitled note something rather than an empty string', () => {
    // An empty slug would collide with every other empty slug on a unique
    // index, so the first save would work and the second would fail.
    expect(slugify('...')).toBe('untitled')
    expect(slugify('')).toBe('untitled')
  })
})

describe('extractLinks', () => {
  it('finds a link and slugifies its target', () => {
    expect(extractLinks('See [[Hybrid search]] for the details.')).toEqual(['hybrid-search'])
  })

  it('finds several, in order, without repeating one', () => {
    const body = 'Both [[Note A]] and [[Note B]] say it, and [[Note A]] says it twice.'
    expect(extractLinks(body)).toEqual(['note-a', 'note-b'])
  })

  it('reads the target of a piped link, not its label', () => {
    // [[slug|what to show]] is standard vault syntax, and linking to the label
    // would point at a note that does not exist.
    expect(extractLinks('See [[hybrid-search|the search note]].')).toEqual(['hybrid-search'])
  })

  it('ignores a single bracket, which is ordinary prose', () => {
    expect(extractLinks('An array is written [1, 2, 3] in most languages.')).toEqual([])
  })

  it('ignores an unclosed link rather than swallowing the rest of the note', () => {
    expect(extractLinks('This [[never closes and the note continues')).toEqual([])
  })

  it('does not read a link inside a fenced code block', () => {
    // A vault note about this parser would otherwise link to itself, and worse,
    // a code sample containing [[x]] would create a note nobody asked for.
    const body = [
      'Real link: [[keep me]]',
      '',
      '```',
      'const pattern = /\\[\\[(.+?)\\]\\]/',
      'example: [[not a link]]',
      '```',
      '',
      'And [[also keep me]].',
    ].join('\n')

    expect(extractLinks(body)).toEqual(['keep-me', 'also-keep-me'])
  })

  it('does not read a link inside inline code', () => {
    expect(extractLinks('Write `[[like this]]` to make a link.')).toEqual([])
  })

  it('finds nothing in a note with no links', () => {
    expect(extractLinks('Just some prose.')).toEqual([])
  })
})

describe('renderPreview', () => {
  it('turns a link into its label and leaves the prose alone', () => {
    expect(renderPreview('See [[hybrid-search|the search note]] first.')).toBe(
      'See the search note first.',
    )
    expect(renderPreview('See [[Hybrid search]] first.')).toBe('See Hybrid search first.')
  })

  it('leaves code alone, the same as the parser does', () => {
    expect(renderPreview('Write `[[like this]]`.')).toBe('Write `[[like this]]`.')
  })
})

describe('blocks', () => {
  it('splits paragraphs on a blank line and links inside them', () => {
    expect(blocks('First.\n\nSee [[Hybrid search|the video]] and [[RRF]].')).toEqual([
      { kind: 'p', parts: ['First.'] },
      {
        kind: 'p',
        parts: ['See ', { link: 'hybrid-search', label: 'the video' }, ' and ', { link: 'rrf', label: 'RRF' }, '.'],
      },
    ])
  })

  it('turns dashed and numbered lines into a list without their markers', () => {
    expect(blocks('Rules:\n\n- one\n- two\n\n1. first\n2. second')).toEqual([
      { kind: 'p', parts: ['Rules:'] },
      { kind: 'ul', items: ['one', 'two'] },
      { kind: 'ul', items: ['first', 'second'] },
    ])
  })

  it('leaves a link inside code as text', () => {
    expect(blocks('Use `[[x]]` here.')).toEqual([{ kind: 'p', parts: ['Use `[[x]]` here.'] }])
  })
})
