import { describe, expect, it } from 'vitest'
import { initials } from './initials'

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('Nick Comeaux')).toBe('NC')
    expect(initials('  nick   j   comeaux ')).toBe('NJ')
  })

  it('is one letter for one word and a question mark for none', () => {
    expect(initials('Nick')).toBe('N')
    expect(initials('')).toBe('?')
    expect(initials('   ')).toBe('?')
  })
})
