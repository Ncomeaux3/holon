import { describe, expect, it } from 'vitest'

import { normaliseRepo } from './client'

// The field asks for owner/name. Pasting the browser URL is the obvious way to
// get it wrong, and the resulting 404 reads as "no access", which sends you
// looking at the token instead of the field you actually mistyped.

describe('normaliseRepo', () => {
  it('leaves owner/name alone', () => {
    expect(normaliseRepo('nick/obsidian-vault')).toBe('nick/obsidian-vault')
  })

  it('accepts what the browser address bar gives you', () => {
    expect(normaliseRepo('https://github.com/nick/obsidian-vault')).toBe('nick/obsidian-vault')
    expect(normaliseRepo('http://www.github.com/nick/obsidian-vault/')).toBe('nick/obsidian-vault')
  })

  it('accepts both clone URLs', () => {
    expect(normaliseRepo('https://github.com/nick/obsidian-vault.git')).toBe('nick/obsidian-vault')
    expect(normaliseRepo('git@github.com:nick/obsidian-vault.git')).toBe('nick/obsidian-vault')
  })

  it('forgives whitespace and stray slashes', () => {
    expect(normaliseRepo('  nick/obsidian-vault  ')).toBe('nick/obsidian-vault')
    expect(normaliseRepo('/nick/obsidian-vault/')).toBe('nick/obsidian-vault')
  })
})
