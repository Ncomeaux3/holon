import { describe, expect, it } from 'vitest'
import { parseFields } from './draft'

describe('parseFields', () => {
  it('returns every field even when the model mentioned few', () => {
    const fields = parseFields('[{"key":"carrier","value":"Harbor Mutual","confidence":0.98}]')

    // A missing field is an empty box to fill in, not one that quietly
    // disappears from the form.
    expect(fields.find((f) => f.key === 'carrier')).toMatchObject({
      value: 'Harbor Mutual',
      confidence: 0.98,
    })
    expect(fields.find((f) => f.key === 'expires_on')).toMatchObject({
      value: '',
      confidence: 0,
    })
    expect(fields).toHaveLength(11)
  })

  it('reads the array out of a reply with prose around it', () => {
    const fields = parseFields('Here you go:\n[{"key":"name","value":"Renters","confidence":0.8}]\nHope that helps.')
    expect(fields.find((f) => f.key === 'name')?.value).toBe('Renters')
  })

  it('gives empty boxes rather than throwing on nonsense', () => {
    // The PDF is still attached. Typing eleven fields beats starting again.
    const fields = parseFields('I could not read that.')
    expect(fields).toHaveLength(11)
    expect(fields.every((f) => f.value === '' && f.confidence === 0)).toBe(true)
  })

  it('clamps a confidence outside the range instead of trusting it', () => {
    const fields = parseFields('[{"key":"limits","value":"100/300/100","confidence":4}]')
    expect(fields.find((f) => f.key === 'limits')?.confidence).toBe(1)
  })
})
