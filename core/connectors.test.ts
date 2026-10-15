import { describe, expect, it } from 'vitest'
import { categoriesForModules, loadCategories, supportedProviders } from './connectors'

// The catalogue is committed config a fork edits, so the test is about the file
// staying well formed and about the one claim the screen makes: that a provider
// is either really connectable or honestly recorded as a wish.

describe('loadCategories', () => {
  it('parses the committed catalogue', () => {
    const categories = loadCategories()
    expect(categories.length).toBeGreaterThan(0)
  })

  it('gives every category the fields the wizard renders', () => {
    for (const category of loadCategories()) {
      expect(category.id).toMatch(/^[a-z]+$/)
      expect(category.name.length).toBeGreaterThan(0)
      expect(category.module.length).toBeGreaterThan(0)
      // The "what it would give you" line. A category without one is a box the
      // reader cannot make a decision about.
      expect(category.data.length).toBeGreaterThan(0)
      expect(category.providers.length).toBeGreaterThan(0)
    }
  })

  it('names each category once', () => {
    const ids = loadCategories().map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('categoriesForModules', () => {
  it('offers only what the installed modules can use', () => {
    const finance = categoriesForModules(['finance'])
    expect(finance.length).toBeGreaterThan(0)
    expect(finance.every((c) => c.module === 'finance')).toBe(true)
  })

  it('offers nothing for a module a fork deleted', () => {
    expect(categoriesForModules([])).toEqual([])
    expect(categoriesForModules(['nothing-installed'])).toEqual([])
  })
})

describe('supportedProviders', () => {
  it('marks a provider supported only when an integration backs it', () => {
    const supported = supportedProviders()

    // Strava has a manifest in integrations/, so the catalogue entry is real.
    expect(supported.has('Strava')).toBe(true)

    // No bank integration is installed under any of these names, so they are
    // recorded as requested rather than pretending to sync.
    expect(supported.has('Chase')).toBe(false)
    expect(supported.has('Marriott Bonvoy')).toBe(false)
  })
})
