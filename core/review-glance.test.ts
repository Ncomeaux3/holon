import { describe, expect, it } from 'vitest'
import { glanceTiles } from './review-glance'

// The six numbers POS Weekly Review.dc.html puts at the top of the review, in
// its order, each from one module's digest. A tile is only there when its
// module wrote a digest with the key; a delta line only when there is
// something to compare against.

const now = {
  tasks: { completedThisWeek: 23, overdue: 4, rolledTwice: 2 },
  finance: { netWorthCents: 41286000, changeCents: 730000, spendCents: 288900, budgetCents: 345000 },
  fitness: { workoutsThisWeek: 4, loadThisWeek: 312, loadLastWeek: 294 },
  skills: {
    xpThisWeek: 1240,
    attributes: [{ skillId: 'planning', name: 'Planning', level: 7 }],
    gainedThisWeek: [{ skillId: 'planning', name: 'Planning', gained: 620 }],
  },
}

const lastWeek = {
  tasks: { completedThisWeek: 19, overdue: 3 },
  skills: { attributes: [{ skillId: 'planning', name: 'Planning', level: 6 }] },
}

describe('glanceTiles', () => {
  it('draws the artboard: six tiles, in order, with the artboard delta lines', () => {
    expect(glanceTiles(now, lastWeek)).toEqual([
      { module: 'tasks', label: 'Tasks closed', value: '23', delta: '+4 vs last week', tone: 'brand' },
      { module: 'tasks', label: 'Slipped', value: '4', delta: '2 rolled twice', tone: 'warn' },
      { module: 'finance', label: 'Spend vs budget', value: '84%', delta: '$2,889 of $3,450', tone: 'brand' },
      { module: 'finance', label: 'Net worth', value: '+1.8%', delta: '$412,860', tone: 'brand' },
      { module: 'fitness', label: 'Workouts', value: '4', delta: 'load 312 · +18', tone: 'brand' },
      { module: 'skills', label: 'XP earned', value: '1,240', delta: 'Planning → level 7', tone: 'brand' },
    ])
  })

  it('hides a tile whose module wrote no digest or no key', () => {
    const tiles = glanceTiles({ tasks: { overdue: 1 } }, {})
    expect(tiles.map((t) => t.label)).toEqual(['Slipped'])
    expect(glanceTiles({}, {})).toEqual([])
  })

  it('leaves the delta off when there is nothing to compare against', () => {
    const tiles = glanceTiles({ tasks: { completedThisWeek: 5, overdue: 2 } }, {})
    expect(tiles.map((t) => t.delta)).toEqual([null, null])
    expect(tiles.map((t) => t.tone)).toEqual(['quiet', 'quiet'])
  })

  it('colours a fall in closed tasks and a rise in slipped ones as a warning', () => {
    const tiles = glanceTiles(
      { tasks: { completedThisWeek: 5, overdue: 6, rolledTwice: 0 } },
      { tasks: { completedThisWeek: 9, overdue: 2 } },
    )
    expect(tiles[0]).toMatchObject({ delta: '-4 vs last week', tone: 'warn' })
    expect(tiles[1]).toMatchObject({ delta: '+4 vs last week', tone: 'warn' })
    expect(glanceTiles({ tasks: { completedThisWeek: 5 } }, { tasks: { completedThisWeek: 5 } })[0]).toMatchObject({
      delta: 'no change vs last week',
      tone: 'quiet',
    })
  })

  it('spend at or over budget is a warning, and no budget is no tile', () => {
    const over = glanceTiles({ finance: { spendCents: 350000, budgetCents: 345000 } }, {})
    expect(over[0]).toMatchObject({ value: '101%', tone: 'warn' })
    expect(glanceTiles({ finance: { spendCents: 350000, budgetCents: 0 } }, {})).toEqual([])
  })

  it('net worth with nothing to measure against is the figure, quietly', () => {
    const tile = glanceTiles({ finance: { netWorthCents: 41286000, changeCents: 0 } }, {})[0]
    expect(tile).toMatchObject({ value: '0.0%', delta: '$412,860', tone: 'quiet' })
    const fresh = glanceTiles({ finance: { netWorthCents: 500000, changeCents: 500000 } }, {})[0]
    expect(fresh).toMatchObject({ value: '$5,000', delta: null, tone: 'quiet' })
  })

  it('workouts carry the load, and a lighter week is quiet rather than a warning', () => {
    const tile = glanceTiles({ fitness: { workoutsThisWeek: 3, loadThisWeek: 200, loadLastWeek: 260 } }, {})[0]
    expect(tile).toMatchObject({ delta: 'load 200 · -60', tone: 'quiet' })
    expect(glanceTiles({ fitness: { workoutsThisWeek: 3 } }, {})[0].delta).toBeNull()
  })

  it('xp names the biggest gain when no level moved, and nothing when nothing did', () => {
    const gained = glanceTiles(
      { skills: { xpThisWeek: 120, gainedThisWeek: [{ skillId: 'sql', name: 'SQL', gained: 120 }] } },
      {},
    )[0]
    expect(gained).toMatchObject({ delta: 'SQL +120', tone: 'brand' })
    expect(glanceTiles({ skills: { xpThisWeek: 0, gainedThisWeek: [] } }, {})[0]).toMatchObject({
      value: '0',
      delta: null,
      tone: 'quiet',
    })
  })
})
