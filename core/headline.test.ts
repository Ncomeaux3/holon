import { describe, expect, it } from 'vitest'

import { headlineSegments, writeHeadline } from './orchestrator'
import type { Summary } from './orchestrator'

// The sentence at the top of the dashboard. It used to be written by Haiku and
// is a template now, so what it says is testable rather than sampled.

function summary(over: Partial<Summary> = {}): Summary {
  return {
    alerts: [],
    failedJobs: [],
    pendingProposals: 0,
    unreadNotifications: 0,
    spendCents: 0,
    capCents: 1000,
    modules: [],
    ...over,
  }
}

const alert = (tone: 'bad' | 'warn') => ({ tone, title: 'x', detail: '' }) as Summary['alerts'][0]

describe('writeHeadline', () => {
  // Silence is the correct output. A dashboard that says "all good" every
  // morning trains you to stop reading it.
  it('says nothing when there is nothing to say', () => {
    expect(writeHeadline(summary())).toBeNull()
  })

  it('counts the bad ones separately from the warnings', () => {
    const text = writeHeadline(
      summary({ alerts: [alert('bad'), alert('bad'), alert('warn')] }),
    )
    expect(text).toBe('2 things needing attention and 1 warning.')
  })

  it('reads as a sentence with three clauses', () => {
    const text = writeHeadline(
      summary({
        alerts: [alert('warn')],
        failedJobs: [{ module: 'finance', name: 'sync' }],
        pendingProposals: 2,
      }),
    )
    expect(text).toBe('1 warning, 1 failed job and 2 proposals waiting.')
  })

  it('singularises', () => {
    expect(writeHeadline(summary({ pendingProposals: 1 }))).toBe('1 proposal waiting.')
  })

  // The cap is the one number worth naming unprompted: it is the only thing
  // on the dashboard that stops working when it is reached.
  it('names the cap once research has stopped', () => {
    const text = writeHeadline(
      summary({ pendingProposals: 1, spendCents: 1000, capCents: 1000 }),
    )
    expect(text).toContain('reached the 10.00 cap')
  })

  it('stays quiet about the cap while there is room left', () => {
    const text = writeHeadline(summary({ pendingProposals: 1, spendCents: 400, capCents: 1000 }))
    expect(text).toBe('1 proposal waiting.')
  })

  // It cannot reach a model, so it cannot invent one. That is the whole reason
  // this is a template.
  it('never contains a number the summary did not carry', () => {
    const text = writeHeadline(summary({ alerts: [alert('bad')], pendingProposals: 3 })) ?? ''
    const digits = text.match(/\d+/g) ?? []
    expect(digits).toEqual(['1', '3'])
  })
})

describe('headlineSegments', () => {
  // The dashboard underlines the runs that name something you can open, so the
  // pieces have to come out separately and still read as one sentence.
  it('links each part and joins back to the plain sentence', () => {
    const s = summary({ alerts: [alert('bad')], failedJobs: [{ module: 'core', name: 'nightly' }], pendingProposals: 2 })
    const segments = headlineSegments(s)

    expect(segments.map((x) => x.text).join('')).toBe(writeHeadline(s))
    expect(segments.filter((x) => x.href).map((x) => x.href)).toEqual([
      '/notifications',
      '/agent-log',
      '/review',
    ])
  })

  it('is empty on a quiet night, which is what makes the headline null', () => {
    expect(headlineSegments(summary())).toEqual([])
  })

  it('points the cap sentence at the setting that raises it', () => {
    const segments = headlineSegments(summary({ pendingProposals: 1, spendCents: 1000, capCents: 1000 }))
    expect(segments.find((x) => x.href === '/settings')?.text).toBe('10.00 cap')
  })
})

// POS Dashboard.dc.html's sentence, from digests: the net worth move, the
// budgets past the line with the days left in the month, the skill that has
// gone longest without an event. Still a template; every number is a digest's.
describe('headlineSegments from digests', () => {
  const today = '2026-09-11'
  const finance = { module: 'finance', payload: { netWorthCents: 21638400, changeCents: 418000, overBudget: [{ name: 'Dining', percent: 88 }, { name: 'Fitness', percent: 90 }] } }
  const skills = { module: 'skills', payload: { stagnant: [{ skillId: 'negotiation', name: 'Negotiation', lastEventAt: '2026-06-29T12:00:00Z' }] } }
  const text = (s: ReturnType<typeof headlineSegments>) => s.map((x) => x.text).join('')
  const links = (s: ReturnType<typeof headlineSegments>) => s.filter((x) => x.href).map((x) => [x.text, x.href])

  it('reads the three clauses as the artboard writes them', () => {
    const s = headlineSegments(summary({ modules: [finance, skills] }), today)
    expect(text(s)).toBe(
      'Net worth climbed $4,180 in 30 days. Dining and Fitness are past 80% of budget with 19 days left, and Negotiation has gone 74 days without a linked event.',
    )
    expect(links(s)).toEqual([
      ['$4,180 in 30 days', '/finance'],
      ['Dining and Fitness are past 80%', '/finance'],
      ['Negotiation has gone 74 days', '/skills'],
    ])
  })

  it('says fell and held, and one budget on its own', () => {
    const fell = { module: 'finance', payload: { netWorthCents: 1, changeCents: -120000, overBudget: [{ name: 'Dining', percent: 91 }] } }
    expect(text(headlineSegments(summary({ modules: [fell] }), today))).toBe(
      'Net worth fell $1,200 in 30 days. Dining is past 80% of budget with 19 days left.',
    )
    const held = { module: 'finance', payload: { netWorthCents: 1, changeCents: 0, overBudget: [] } }
    expect(text(headlineSegments(summary({ modules: [held] }), today))).toBe('Net worth held over 30 days.')
  })

  it('drops a clause whose digest is missing and keeps the sentence whole', () => {
    expect(text(headlineSegments(summary({ modules: [skills] }), today))).toBe(
      'Negotiation has gone 74 days without a linked event.',
    )
    const budgetsOnly = { module: 'finance', payload: { overBudget: [{ name: 'Dining', percent: 91 }, { name: 'Fitness', percent: 90 }, { name: 'Travel', percent: 85 }] } }
    expect(text(headlineSegments(summary({ modules: [budgetsOnly, skills] }), today))).toBe(
      'Dining, Fitness and Travel are past 80% of budget with 19 days left, and Negotiation has gone 74 days without a linked event.',
    )
  })

  it('names the threshold the digest was flagged at', () => {
    const f = { module: 'finance', payload: { alertThreshold: 90, overBudget: [{ name: 'Dining', percent: 91 }] } }
    expect(text(headlineSegments(summary({ modules: [f] }), today))).toBe(
      'Dining is past 90% of budget with 19 days left.',
    )
  })

  it('falls back to the alerts sentence when no digest has a clause', () => {
    const s = summary({ pendingProposals: 2, modules: [{ module: 'finance', payload: { overBudget: [] } }] })
    expect(text(headlineSegments(s, today))).toBe('2 proposals waiting.')
    expect(writeHeadline(summary(), today)).toBeNull()
  })
})
