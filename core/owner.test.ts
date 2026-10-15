import { describe, expect, it } from 'vitest'
import { isPublicPath } from './owner'

// The legal pages are public; nothing under the app shell is, and the prefix
// match must not leak a neighbouring path.
describe('isPublicPath', () => {
  it('lets the legal pages through signed out', () => {
    for (const p of ['/terms', '/privacy', '/privacy/health', '/login']) expect(isPublicPath(p)).toBe(true)
  })

  it('keeps the app and look-alike paths behind sign-in', () => {
    for (const p of ['/', '/settings', '/privacyx', '/terms-old', '/calendar']) expect(isPublicPath(p)).toBe(false)
  })
})
