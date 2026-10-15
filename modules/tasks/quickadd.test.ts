import { describe, expect, it } from 'vitest'
import { dueLabel, parseQuickAdd } from './quickadd'

// The parser has to say what it understood, because the design shows that back
// before anything is saved. A token it did not recognise stays in the title
// rather than being swallowed: silently dropping "#homme" would lose the word.

const projects = ['POS', 'Home', 'Health', 'Career', 'Finance', 'Learning']

// A Tuesday, so the weekday cases have a fixed answer.
const TUESDAY = new Date(2026, 8, 8)

const parse = (input: string) => parseQuickAdd(input, { projects, now: TUESDAY })

describe('parseQuickAdd', () => {
  it('keeps a bare title as the title', () => {
    const r = parse('Renew the renters policy')
    expect(r.title).toBe('Renew the renters policy')
    expect(r.priority).toBe('P2')
    expect(r.dueInDays).toBeNull()
    expect(r.estimateMinutes).toBeNull()
    expect(r.project).toBeNull()
    expect(r.parsed).toEqual([])
  })

  it('reads priority and strips it', () => {
    expect(parse('Pay the card !p1').priority).toBe('P1')
    expect(parse('Pay the card !p1').title).toBe('Pay the card')
    expect(parse('Read a chapter !P3').priority).toBe('P3')
  })

  it('matches a project case insensitively and keeps an unknown one in the title', () => {
    expect(parse('Ship search #pos').project).toBe('POS')
    expect(parse('Ship search #pos').title).toBe('Ship search')

    const unknown = parse('Ship search #nope')
    expect(unknown.project).toBeNull()
    expect(unknown.title).toBe('Ship search #nope')
  })

  it('reads the named days', () => {
    expect(parse('x @today').dueInDays).toBe(0)
    expect(parse('x @tomorrow').dueInDays).toBe(1)
    expect(parse('x @tmrw').dueInDays).toBe(1)
    expect(parse('x @week').dueInDays).toBe(4)
    expect(parse('x @later').dueInDays).toBe(14)
  })

  it('reads a weekday as the next one, never today', () => {
    // Tuesday to Friday is three days.
    expect(parse('x @fri').dueInDays).toBe(3)
    expect(parse('x @friday').dueInDays).toBe(3)
    // Tuesday to Monday wraps to six.
    expect(parse('x @mon').dueInDays).toBe(6)
    // Naming the day it already is means next week, not zero: "@tue" on a
    // Tuesday is a task for next Tuesday, and @today is how you say today.
    expect(parse('x @tue').dueInDays).toBe(7)
  })

  it('reads an estimate in minutes or hours', () => {
    expect(parse('Draft the plan 30m').estimateMinutes).toBe(30)
    expect(parse('Draft the plan 45 min').estimateMinutes).toBe(45)
    expect(parse('Draft the plan 2h').estimateMinutes).toBe(120)
    expect(parse('Draft the plan 1.5h').estimateMinutes).toBe(90)
    expect(parse('Draft the plan 30m').title).toBe('Draft the plan')
  })

  it('does not eat a number that is part of the title', () => {
    expect(parse('Read DDIA ch. 5').estimateMinutes).toBeNull()
    expect(parse('Read DDIA ch. 5').title).toBe('Read DDIA ch. 5')
    expect(parse('Deadlift 385').estimateMinutes).toBeNull()
  })

  it('takes every token at once and collapses the whitespace they leave', () => {
    const r = parse('!p1 Test bank sync #POS @thu 60m')
    expect(r).toMatchObject({
      title: 'Test bank sync',
      priority: 'P1',
      project: 'POS',
      dueInDays: 2,
      estimateMinutes: 60,
    })
  })

  it('reports what it understood, in the order the fields are shown', () => {
    const r = parse('Pay the card !p1 #Finance @tomorrow 5m')
    expect(r.parsed).toEqual([
      { field: 'Due', value: 'Tomorrow' },
      { field: 'Priority', value: 'P1' },
      { field: 'Project', value: 'Finance' },
      { field: 'Estimate', value: '5m' },
    ])
  })

  it('refuses a title that is only tokens', () => {
    expect(parse('!p1 #POS @today').title).toBe('')
  })

  it('names the weekday from the date it was given, not from the clock', () => {
    // Tuesday plus two is Thursday, whatever day the suite happens to run on.
    expect(parse('x @thu').parsed).toEqual([{ field: 'Due', value: 'Thu' }])
  })
})

describe('dueLabel', () => {
  it('names the day inside a week and the date past it', () => {
    const fri = new Date(2026, 8, 11)
    expect(dueLabel(-1, fri)).toBe('1d overdue')
    expect(dueLabel(0, fri)).toBe('Today')
    expect(dueLabel(1, fri)).toBe('Tomorrow')
    expect(dueLabel(3, fri)).toBe('Mon')
    expect(dueLabel(12, fri)).toBe('Sep 23')
    expect(dueLabel(null, fri)).toBe('No date')
  })
})
