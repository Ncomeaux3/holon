import { describe, expect, it } from 'vitest'
import { MAX_CODE_LENGTH, isCompleteCode, normalizeCode, verifyWithAnyType } from './otp'

describe('normalizeCode', () => {
  it('keeps a clean code as it is', () => {
    expect(normalizeCode('483920')).toBe('483920')
  })

  // Every one of these is a real code the owner typed or pasted correctly.
  it('strips what a paste from a mail app brings with it', () => {
    expect(normalizeCode(' 483920 ')).toBe('483920')
    expect(normalizeCode('483 920')).toBe('483920')
    expect(normalizeCode('483-920')).toBe('483920')
    expect(normalizeCode('483 920')).toBe('483920')
    expect(normalizeCode('Code: 483920.')).toBe('483920')
  })

  // The bug this exists for: Email OTP Length is a Supabase project setting
  // from 6 to 10, and this project issues 8. A build that capped at 6 threw the
  // last two digits away before anything was submitted and then told the owner
  // their correct code was wrong.
  it('keeps every digit of a code longer than six', () => {
    expect(normalizeCode('48392017')).toBe('48392017')
    expect(normalizeCode('4839 2017')).toBe('48392017')
    expect(normalizeCode('4839201234')).toBe('4839201234')
  })

  it('caps at the longest code Supabase can issue, so a paste of the whole email cannot become a guess', () => {
    expect(normalizeCode('4839201234567890')).toHaveLength(MAX_CODE_LENGTH)
    expect(normalizeCode('4839201234567890')).toBe('4839201234')
  })

  it('returns nothing when there are no digits at all', () => {
    expect(normalizeCode('')).toBe('')
    expect(normalizeCode('   ')).toBe('')
    expect(normalizeCode('paste failed')).toBe('')
  })
})

describe('isCompleteCode', () => {
  it('is true from six digits, the shortest Supabase issues', () => {
    expect(isCompleteCode('483920')).toBe(true)
    expect(isCompleteCode('483 920')).toBe(true)
    expect(isCompleteCode('48392')).toBe(false)
    expect(isCompleteCode('')).toBe(false)
  })

  // Length is Supabase's to choose. Anything at or above the shortest it can
  // issue is worth sending; Supabase is what says whether it is right.
  it('is true for the longer codes a project can be configured to send', () => {
    expect(isCompleteCode('48392017')).toBe(true)
    expect(isCompleteCode('4839201234')).toBe(true)
  })
})

describe('verifyWithAnyType', () => {
  it('tries magiclink first, because that is what the evidence points at', async () => {
    const tried: string[] = []
    const result = await verifyWithAnyType(async (type) => {
      tried.push(type)
      return null
    })

    expect(tried).toEqual(['magiclink'])
    expect(result).toEqual({ ok: true, type: 'magiclink', error: null })
  })

  // The bug this exists for: 'email' is what Supabase documents and what the
  // first build shipped, and it refused every valid code on the real project.
  it('keeps going past a refusal and succeeds on a later type', async () => {
    const tried: string[] = []
    const result = await verifyWithAnyType(async (type) => {
      tried.push(type)
      return type === 'recovery' ? null : 'token has expired or is invalid'
    })

    expect(tried).toEqual(['magiclink', 'email', 'recovery'])
    expect(result.ok).toBe(true)
    expect(result.type).toBe('recovery')
  })

  it('stops at the first success rather than spending the rest', async () => {
    const tried: string[] = []
    await verifyWithAnyType(async (type) => {
      tried.push(type)
      return type === 'magiclink' ? 'no' : null
    })

    expect(tried).toEqual(['magiclink', 'email'])
  })

  it('reports the last error when no type is accepted', async () => {
    const result = await verifyWithAnyType(async (type) => `refused ${type}`)

    expect(result.ok).toBe(false)
    expect(result.type).toBeNull()
    expect(result.error).toBe('refused recovery')
  })
})
