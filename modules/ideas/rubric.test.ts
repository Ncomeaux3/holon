import { describe, expect, it } from 'vitest'
import { isNumeric, keepSourced, parseReport, searchBudget } from './rubric'

describe('isNumeric', () => {
  it('treats a year as context rather than a claim', () => {
    // "Founded in 2019" is not a number anyone can be wrong about in the way
    // "a $4.2bn market" is, and demanding a citation for it strips prose for
    // nothing.
    expect(isNumeric('The category has existed since 2019')).toBe(false)
    expect(isNumeric('Roughly 40,000 of them exist')).toBe(true)
    expect(isNumeric('People find this annoying')).toBe(false)
  })
})

describe('keepSourced', () => {
  const allowed = ['https://example.com/report', 'https://other.example/pricing']

  it('keeps a number whose source was actually searched', () => {
    const claims = [{ text: '12,000 firms in the segment', source: 'https://example.com/report' }]
    expect(keepSourced(claims, allowed)).toHaveLength(1)
  })

  it('drops a number with no source at all', () => {
    const claims = [{ text: 'About 12,000 firms', source: '' }]
    expect(keepSourced(claims, allowed)).toEqual([])
  })

  it('drops a number citing a URL the search never returned', () => {
    // This is the failure that looks most like success: a plausible URL the
    // model produced from memory reads exactly like a citation and is not one.
    const claims = [{ text: '$4.2bn market', source: 'https://madeup.example/market-2026' }]
    expect(keepSourced(claims, allowed)).toEqual([])
  })

  it('keeps an opinion with no source', () => {
    // Opinion is allowed. It just cannot wear numbers it did not earn.
    const claims = [{ text: 'The incumbents are all aimed at teams, not one person', source: '' }]
    expect(keepSourced(claims, allowed)).toHaveLength(1)
  })

  it('ignores trailing slashes and query strings when matching', () => {
    const claims = [{ text: '9 competitors charge monthly', source: 'https://example.com/report/?utm_source=x' }]
    expect(keepSourced(claims, allowed)).toHaveLength(1)
  })
})

describe('parseReport', () => {
  const allowed = ['https://example.com/a']

  const reply = JSON.stringify({
    verdict: 'park',
    confidence: 0.55,
    sections: [
      {
        key: 'market',
        summary: 'Small and fragmented.',
        claims: [
          { text: '3,000 potential buyers', source: 'https://example.com/a' },
          { text: '$40m spent a year', source: 'https://invented.example/x' },
        ],
      },
    ],
  })

  it('returns every section, whether or not the model wrote one', () => {
    const out = parseReport(reply, allowed)
    expect(out.sections.map((s) => s.key)).toEqual([
      'problem',
      'market',
      'competitors',
      'differentiation',
      'feasibility',
    ])
  })

  it('keeps the sourced claim and drops the invented one', () => {
    const market = parseReport(reply, allowed).sections.find((s) => s.key === 'market')!
    expect(market.claims).toHaveLength(1)
    expect(market.claims[0].text).toBe('3,000 potential buyers')
  })

  it('holds the summary to the same rule as a claim', () => {
    // A number smuggled into prose is still a number nobody can check.
    const withNumbers = JSON.stringify({
      verdict: 'build',
      sections: [{ key: 'problem', summary: 'Around 90% of them do it by hand.', claims: [] }],
    })
    const problem = parseReport(withNumbers, allowed).sections.find((s) => s.key === 'problem')!
    expect(problem.summary).toBe('')
  })

  it('falls back to unclear rather than guessing a verdict', () => {
    expect(parseReport('the model wrote prose', allowed).verdict).toBe('unclear')
    expect(parseReport('{"verdict":"maybe"}', allowed).verdict).toBe('unclear')
    expect(parseReport('the model wrote prose', allowed).confidence).toBeNull()
  })

  it('clamps a confidence outside the range instead of trusting it', () => {
    expect(parseReport('{"verdict":"build","confidence":9}', allowed).confidence).toBe(1)
  })
})

describe('searchBudget', () => {
  it('spends more on a deep run and defaults to quick', () => {
    expect(searchBudget('quick')).toBe(4)
    expect(searchBudget('deep')).toBe(12)
    // A cent a search, verified 2026-09-09, so a quick run's search bill is
    // four cents and a deep one is twelve.
    expect(searchBudget('deep')).toBeLessThanOrEqual(20)
  })
})
