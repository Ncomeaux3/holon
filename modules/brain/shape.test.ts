import { describe, expect, it } from 'vitest'
import { ago, byLine, finishedOn, folderLabel, sourceMeta, subLine, wordCount } from './shape'

const NOW = Date.parse('2026-09-11T12:00:00Z')

describe('ago', () => {
  it('reads today, then whole days', () => {
    expect(ago('2026-09-11T08:00:00Z', NOW)).toBe('today')
    expect(ago('2026-09-10T08:00:00Z', NOW)).toBe('1d')
    expect(ago('2026-09-02T08:00:00Z', NOW)).toBe('9d')
  })
})

describe('wordCount', () => {
  it('counts words and nothing else', () => {
    expect(wordCount('one two\n\nthree')).toBe(3)
    expect(wordCount('   ')).toBe(0)
  })
})

describe('subLine', () => {
  it('leads with the host of a fetched note', () => {
    expect(subLine({ kind: 'article', sourceUrl: 'https://www.example.com/post', source: 'agent', externalId: null, body: 'a b c' })).toBe('example.com · 3 words')
  })
  it('leads with the vault folder of a pulled note', () => {
    expect(subLine({ kind: 'note', sourceUrl: '', source: 'vault', externalId: 'Notes/Hybrid search.md', body: 'a' })).toBe('Notes · 1 word')
  })
  it('leads with the kind otherwise', () => {
    expect(subLine({ kind: 'book', sourceUrl: '', source: 'manual', externalId: null, body: 'a b' })).toBe('book · 2 words')
  })
})

describe('byLine', () => {
  it('counts how the links were classified, in the artboard order', () => {
    expect(byLine([{ by: 'rule' }, { by: 'model' }, { by: 'rule' }])).toBe('RULES · 2 · MODEL · 1')
    expect(byLine([{ by: 'manual' }])).toBe('MANUAL · 1')
    expect(byLine([])).toBe('')
  })
})

describe('sourceMeta', () => {
  it('names where the source text came from', () => {
    expect(sourceMeta({ sourceUrl: 'https://youtube.com/watch?v=x', sourceText: 'a b c d', kind: 'video' })).toBe('YouTube · 4 words')
    expect(sourceMeta({ sourceUrl: 'https://example.com', sourceText: 'a b', kind: 'article' })).toBe('URL · 2 words')
    expect(sourceMeta({ sourceUrl: '', sourceText: 'a', kind: 'book' })).toBe('Manual · book')
  })
})

describe('labels', () => {
  it('pluralises the folder the way the artboard does', () => {
    expect(folderLabel('article')).toBe('articles')
    expect(folderLabel('person')).toBe('people')
    expect(folderLabel('daily')).toBe('daily')
  })
  it('writes the finished date as the artboard does', () => {
    expect(finishedOn('2026-08-12T10:00:00Z')).toBe('Aug 12')
  })
})
