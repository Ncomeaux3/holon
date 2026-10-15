import { describe, expect, it } from 'vitest'
import { weekNumber, weekOf } from './reviews'
import {
  closeHelper,
  EMPTY_ANSWERS,
  glanceHelper,
  glanceSentence,
  missesHelper,
  outstanding,
  renderNote,
  type ReviewAnswers,
} from './reviews-shape'

describe('weekOf', () => {
  it('returns the Monday that starts the week', () => {
    // 2026-09-08 is a Tuesday.
    expect(weekOf('2026-09-08')).toBe('2026-09-07')
    expect(weekOf('2026-09-07')).toBe('2026-09-07')
    expect(weekOf('2026-09-11')).toBe('2026-09-07')
  })

  it('puts Sunday in the week that already started', () => {
    // 2026-09-13 is a Sunday, and it belongs to the week beginning the 7th,
    // not to the one beginning tomorrow.
    expect(weekOf('2026-09-13')).toBe('2026-09-07')
    expect(weekOf('2026-09-14')).toBe('2026-09-14')
  })

  it('crosses a month and a year boundary', () => {
    expect(weekOf('2026-10-01')).toBe('2026-09-28')
    expect(weekOf('2027-01-01')).toBe('2026-12-28')
  })

  it('starts on Sunday when the owner says so', () => {
    expect(weekOf('2026-09-13', 'sunday')).toBe('2026-09-13')
    expect(weekOf('2026-09-12', 'sunday')).toBe('2026-09-06')
  })
})

describe('weekNumber', () => {
  it('counts ISO weeks, which is what the band calls the week', () => {
    // 2026-09-07 is the Monday of ISO week 37, and every day of that week
    // answers with the same number.
    expect(weekNumber('2026-09-07')).toBe(37)
    expect(weekNumber('2026-09-13')).toBe(37)
    expect(weekNumber('2026-01-01')).toBe(1)
  })

  it('gives late December the week one it belongs to', () => {
    // 2025-12-29 is the Monday of the week holding 1 January 2026, so it is
    // week one of 2026 rather than week 53 of 2025.
    expect(weekNumber('2025-12-29')).toBe(1)
  })

  it('numbers a Sunday week by its Thursday', () => {
    // Sun 2026-09-06 to Sat 09-12 holds Thursday 09-10, ISO week 37.
    expect(weekNumber('2026-09-06', 'sunday')).toBe(37)
    expect(weekNumber('2026-09-12', 'sunday')).toBe(37)
    // Sun 2025-12-28 to Sat 2026-01-03 holds 1 January's Thursday.
    expect(weekNumber('2025-12-28', 'sunday')).toBe(1)
  })
})

describe('outstanding', () => {
  const answers: ReviewAnswers = {
    ...EMPTY_ANSWERS,
    missActions: { a: 'carry' },
    checkins: { g1: 11 },
  }

  it('counts the decisions still owed on the step that owes them', () => {
    expect(outstanding('misses', answers, { misses: 4, manualGoals: 2 })).toBe(3)
    expect(outstanding('goals', answers, { misses: 4, manualGoals: 2 })).toBe(1)
  })

  it('owes nothing on a step that only reads', () => {
    expect(outstanding('glance', answers, { misses: 4, manualGoals: 2 })).toBe(0)
    expect(outstanding('close', answers, { misses: 4, manualGoals: 2 })).toBe(0)
  })
})

describe('renderNote', () => {
  const context = {
    weekLabel: '7 Sep 2026',
    winTitles: { w1: 'Shipped the drill-ins' },
    missTitles: { m1: 'Rebalance the allocation', m2: 'Call the carrier' },
    goalLines: ['Net worth, 44 percent'],
    pickTitles: { t1: 'Run the time trial' },
  }

  it('writes every section, with the reason when there is one', () => {
    const note = renderNote(
      {
        ...EMPTY_ANSWERS,
        wins: ['w1'],
        ownWins: ['Slept properly'],
        missActions: { m1: 'carry', m2: 'drop' },
        reasons: { m2: 'not worth it any more' },
        picks: ['t1'],
        intent: 'One thing at a time',
      },
      context,
    )

    expect(note).toContain('# Week of 7 Sep 2026')
    expect(note).toContain('- Shipped the drill-ins')
    expect(note).toContain('- Slept properly')
    expect(note).toContain('- Rebalance the allocation, carried to next week')
    expect(note).toContain('- Call the carrier, dropped (not worth it any more)')
    expect(note).toContain('1. Run the time trial')
    expect(note).toContain('Intent: One thing at a time')
  })

  it('says a section was empty rather than leaving a bare heading', () => {
    const note = renderNote(EMPTY_ANSWERS, { ...context, goalLines: [] })
    expect(note).toContain('- Nothing recorded.')
    expect(note).toContain('- Nothing recorded.')
    expect(note).toContain('- Nothing recorded.')
    expect(note).toContain('- Nothing recorded.')
  })
})

// The artboard's copy, built from the numbers rather than typed, so it is
// true on a week that is not the one the designer invented.
describe('the sentences the review says about the week', () => {
  const tile = (label: string, value: string) => ({ module: 'x', label, value, delta: null, tone: 'quiet' as const })

  it('glanceSentence reads the tiles into one sentence, dropping what is not there', () => {
    expect(
      glanceSentence(
        [tile('Tasks closed', '23'), tile('Slipped', '4'), tile('Spend vs budget', '84%'), tile('Workouts', '4')],
        1,
      ),
    ).toBe(
      'The shape of the week: 23 tasks closed and 4 slipped, spend at 84% of budget, 4 workouts, and one goal that has not moved.',
    )
    expect(glanceSentence([tile('Tasks closed', '1'), tile('Workouts', '1')], 0)).toBe(
      'The shape of the week: 1 task closed and 1 workout.',
    )
    expect(glanceSentence([tile('Slipped', '2')], 2)).toBe(
      'The shape of the week: 2 slipped and two goals that have not moved.',
    )
    expect(glanceSentence([], 0)).toBe('No numbers yet this week.')
  })

  it('glanceHelper names the modules that contributed', () => {
    expect(glanceHelper(['Finance', 'Tasks', 'Fitness', 'Skill Tree'])).toBe(
      'Pulled from Finance, Tasks, Fitness and Skill Tree. Nothing here needs your input; read it, then move on.',
    )
    expect(glanceHelper(['Tasks'])).toBe(
      'Pulled from Tasks. Nothing here needs your input; read it, then move on.',
    )
    expect(glanceHelper([])).toBe(
      'Pulled from the module digests. Nothing here needs your input; read it, then move on.',
    )
  })

  it('missesHelper counts in words', () => {
    expect(missesHelper(4)).toBe(
      'Four items missed their date. Each one needs a decision: carry it, drop it, or shrink it.',
    )
    expect(missesHelper(1)).toBe('One item missed its date. It needs a decision: carry it, drop it, or shrink it.')
    expect(missesHelper(0)).toBe('Nothing missed its date.')
    expect(missesHelper(14)).toMatch(/^14 items missed their date\./)
  })

  it('closeHelper promises only what the close does', () => {
    expect(closeHelper(3)).toBe(
      'This writes one note, reschedules what you carried, and sets the three priorities.',
    )
    expect(closeHelper(1)).toBe('This writes one note, reschedules what you carried, and sets the one priority.')
    expect(closeHelper(0)).toBe('This writes one note and reschedules what you carried.')
  })
})
