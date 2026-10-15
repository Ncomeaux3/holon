import { describe, expect, it } from 'vitest'
import { renderPush } from './push-shape'

describe('renderPush', () => {
  it('is null when there is nothing to say', () => {
    expect(renderPush([])).toBeNull()
  })

  it('leads with the first item and counts the rest', () => {
    // A lock screen notification listing six things is one nobody reads.
    const out = renderPush([
      { title: 'Bill due Thursday', urgency: 'normal' },
      { title: 'Two screenings overdue', urgency: 'normal' },
      { title: 'Gutter clean', urgency: 'normal' },
    ])
    expect(out).toEqual({ title: 'Bill due Thursday', body: 'and 2 more things waiting.' })
  })

  it('says so when one of them is urgent', () => {
    const out = renderPush([{ title: 'Card declined', urgency: 'urgent' }])
    expect(out?.title).toBe('Needs you: Card declined')
    expect(out?.body).toBe('Open the dashboard for the detail.')
  })

  it('counts one extra thing in the singular', () => {
    const out = renderPush([
      { title: 'A', urgency: 'normal' },
      { title: 'B', urgency: 'normal' },
    ])
    expect(out?.body).toBe('and 1 more thing waiting.')
  })
})
