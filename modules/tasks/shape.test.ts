import { describe, expect, it } from 'vitest'
import { bucket, columnsFor, daysLeftInWeek, hoursLabel, loadLabel, remindLabel, slipMeta, type Task } from './shape'

const task = (over: Partial<Task> = {}): Task => ({
  id: Math.random().toString(36).slice(2),
  title: 'A task',
  notes: '',
  dueInDays: 0,
  dueAt: null,
  priority: 'P2',
  status: 'open',
  projectId: null,
  projectName: null,
  goalRef: null,
  goalTitle: null,
  ownGoalRef: null,
  projectGoalRef: null,
  estimateMinutes: null,
  remindMinutes: null,
  repeat: null,
  entityRef: null,
  skills: [],
  source: 'manual',
  doneDaysAgo: null,
  ...over,
})

const context = {
  projects: [{ id: 'p1', name: 'POS' }],
  goals: [{ id: 'g1', title: 'Ship POS Phase 1' }],
  weekLeft: 6,
}

describe('bucket', () => {
  it('separates no date from today', () => {
    expect(bucket(null, 6)).toBe('none')
    expect(bucket(0, 6)).toBe('today')
  })

  it('calls anything past its date overdue', () => {
    expect(bucket(-1, 6)).toBe('overdue')
    expect(bucket(-30, 6)).toBe('overdue')
  })

  it('runs the week to its last day and later from the day after', () => {
    // On the week's first day six days are left.
    expect(bucket(1, 6)).toBe('week')
    expect(bucket(6, 6)).toBe('week')
    expect(bucket(7, 6)).toBe('later')
    // Three days before the end, the fourth day out is next week.
    expect(bucket(3, 3)).toBe('week')
    expect(bucket(4, 3)).toBe('later')
    // On the last day nothing is left of the week but today.
    expect(bucket(1, 0)).toBe('later')
  })
})

describe('daysLeftInWeek', () => {
  // 2026-10-14 is a Wednesday.
  it('counts to Sunday for a Monday week and to Saturday for a Sunday one', () => {
    expect(daysLeftInWeek('2026-10-14', 'monday')).toBe(4)
    expect(daysLeftInWeek('2026-10-14', 'sunday')).toBe(3)
    expect(daysLeftInWeek('2026-10-18', 'monday')).toBe(0)
    expect(daysLeftInWeek('2026-10-18', 'sunday')).toBe(6)
  })
})

describe('loadLabel', () => {
  it('says nothing when there is nothing estimated', () => {
    expect(loadLabel(0)).toBe('')
  })

  it('reads minutes under an hour and hours over one', () => {
    expect(loadLabel(45)).toBe('45m')
    expect(loadLabel(60)).toBe('1h')
    expect(loadLabel(130)).toBe('2h 10m')
  })
})

describe('hoursLabel', () => {
  it('reads minutes under an hour and decimal hours over one', () => {
    expect(hoursLabel(0)).toBe('')
    expect(hoursLabel(45)).toBe('45 min')
    expect(hoursLabel(250)).toBe('4.2 h')
    expect(hoursLabel(120)).toBe('2 h')
  })
})

describe('remindLabel', () => {
  it('is the lead time, or the time itself for a reminder at the time', () => {
    expect(remindLabel(null, '17:30')).toBeNull()
    expect(remindLabel(30, '17:30')).toBe('-30M')
    expect(remindLabel(1440, null)).toBe('-1D')
    expect(remindLabel(0, '17:30')).toBe('17:30')
    expect(remindLabel(0, null)).toBeNull()
  })
})

describe('columnsFor', () => {
  it('puts an overdue task in Today, because a slip is today', () => {
    const columns = columnsFor('today', [task({ dueInDays: -3 })], context)
    expect(columns).toHaveLength(1)
    expect(columns[0].tasks).toHaveLength(1)
  })

  it('ends This week on the week\'s last day', () => {
    const columns = columnsFor('week', [task({ dueInDays: 2 }), task({ dueInDays: 3 })], { ...context, weekLeft: 2 })
    expect(columns.find((c) => c.id === 'week')!.tasks).toHaveLength(1)
    expect(columns.find((c) => c.id === 'later')!.tasks).toHaveLength(1)
  })

  it('sweeps undated work into Later rather than losing it', () => {
    const columns = columnsFor('week', [task({ dueInDays: null })], context)
    const later = columns.find((c) => c.id === 'later')!
    expect(later.tasks).toHaveLength(1)
  })

  it('sums the column load into its meta', () => {
    const columns = columnsFor(
      'today',
      [task({ estimateMinutes: 90 }), task({ estimateMinutes: 40 })],
      context,
    )
    expect(columns[0].meta).toBe('2 tasks, about 2.2 h')
  })

  it('counts without a load when nothing is estimated', () => {
    expect(columnsFor('today', [task()], context)[0].meta).toBe('1 task')
  })

  it('sorts by priority first, then time of day', () => {
    const columns = columnsFor(
      'today',
      [
        task({ title: 'p3 early', priority: 'P3', dueAt: '09:00' }),
        task({ title: 'p1 late', priority: 'P1', dueAt: '17:30' }),
        task({ title: 'p1 early', priority: 'P1', dueAt: '08:00' }),
      ],
      context,
    )
    expect(columns[0].tasks.map((t) => t.title)).toEqual(['p1 early', 'p1 late', 'p3 early'])
  })

  it('always offers a No goal column, so nothing is invisible', () => {
    const columns = columnsFor('goal', [task()], context)
    expect(columns.map((c) => c.id)).toEqual(['g1', 'no-goal'])
    expect(columns[1].tasks).toHaveLength(1)
  })

  it('gives an unfiled task a column of its own too', () => {
    const columns = columnsFor('project', [task()], context)
    expect(columns.map((c) => c.id)).toEqual(['p1', 'no-project'])
    expect(columns[1].tasks).toHaveLength(1)
  })

  it('keeps a task waiting for approval out of every working view', () => {
    const waiting = task({ status: 'review', source: 'agent' })
    for (const view of ['today', 'week', 'goal', 'project'] as const) {
      const shown = columnsFor(view, [waiting], context).flatMap((c) => c.tasks)
      expect(shown).toHaveLength(0)
    }
    expect(columnsFor('review', [waiting], context)[0].tasks).toHaveLength(1)
  })

  it('splits Done into today and the rest of the week', () => {
    const columns = columnsFor(
      'done',
      [
        task({ status: 'done', doneDaysAgo: 0 }),
        task({ status: 'done', doneDaysAgo: 3 }),
      ],
      context,
    )
    expect(columns[0].tasks).toHaveLength(1)
    expect(columns[1].tasks).toHaveLength(1)
  })

  it('makes a read only column say so by having no drop target', () => {
    expect(columnsFor('done', [], context).every((c) => c.drop === null)).toBe(true)
    expect(columnsFor('review', [], context).every((c) => c.drop === null)).toBe(true)
    expect(columnsFor('week', [], context).every((c) => c.drop !== null)).toBe(true)
  })
})

// The grey line under a slipped item on the weekly review, as POS Weekly
// Review.dc.html writes it: "Due Tue · rolled 3 times · Finance". The estimate
// is not here; the review appends it.
describe('slipMeta', () => {
  const today = '2026-09-11' // a Friday

  it('names the weekday when the date is inside the last six days', () => {
    expect(slipMeta({ dueOn: '2026-09-08', today, rolls: 3, project: 'Finance' })).toBe(
      'Due Tue · rolled 3 times · Finance',
    )
  })

  it('names the date when it is older than that', () => {
    expect(slipMeta({ dueOn: '2026-09-02', today, rolls: 1, project: 'Finance' })).toBe(
      'Due 2 Sep · rolled once · Finance',
    )
  })

  it('says twice for two, and nothing about rolling for none', () => {
    expect(slipMeta({ dueOn: '2026-09-10', today, rolls: 2, project: null })).toBe('Due Thu · rolled twice')
    expect(slipMeta({ dueOn: '2026-09-10', today, rolls: 0, project: 'Home' })).toBe('Due Thu · Home')
  })

  it('a task due today has not slipped by the weekday, so it says today', () => {
    expect(slipMeta({ dueOn: today, today, rolls: 0, project: null })).toBe('Due today')
  })
})
