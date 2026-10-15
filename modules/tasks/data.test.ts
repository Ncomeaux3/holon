import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/core/db'
import { getModule } from '@/core/modules'
import { callTool } from '@/core/tools'
import { listByGoal, listTasks, patchTask } from './data'

// Against pos_test, because the thing worth proving is one SQL expression:
// coalesce(task.goal_ref, project.goal_ref). The board and the Goals drawer
// both read it, so they cannot disagree.

async function goal(title: string): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into core.entities (module, entity_type, entity_id, title)
     values ('goals', 'goal', gen_random_uuid(), $1) returning id`,
    [title],
  )
  return rows[0].id
}

async function task(title: string, projectId: string | null, goalRef: string | null) {
  await db().query(
    `insert into tasks.task (title, project_id, goal_ref) values ($1, $2, $3)`,
    [title, projectId, goalRef],
  )
}

beforeEach(async () => {
  await db().query('delete from tasks.task')
  await db().query('delete from tasks.project')
  await db().query(`delete from core.entities where module in ('goals', 'tasks')`)
})

describe('patchTask', () => {
  // v1.2 phase 1b: the Skill Tree listed a completion under a title the owner
  // had since changed, because the registry row kept the name from creation.
  it('renames the registry row with the task', async () => {
    const { rows } = await db().query<{ id: string }>(
      `insert into tasks.task (title) values ('POS Skills Version 1.3') returning id`,
    )
    const id = rows[0].id
    await db().query(
      `insert into core.entities (module, entity_type, entity_id, title)
       values ('tasks', 'task', $1, 'POS Skills Version 1.3')`,
      [id],
    )

    await patchTask(id, { title: 'Skill Tree v2 spec' })

    const entity = await db().query<{ title: string }>(
      `select title from core.entities where module = 'tasks' and entity_type = 'task' and entity_id = $1`,
      [id],
    )
    expect(entity.rows[0].title).toBe('Skill Tree v2 spec')
  })
})

describe('a project linked to a goal', () => {
  it('lends its goal to a task that has none, and not to one with its own', async () => {
    const g = await goal('G')
    const h = await goal('H')
    const { rows } = await db().query<{ id: string }>(
      `insert into tasks.project (name, goal_ref) values ('Linked', $1) returning id`,
      [g],
    )
    const project = rows[0].id
    await task('Inherits', project, null)
    await task('Own goal', project, h)
    await task('No project', null, null)

    const forG = (await listByGoal(g)).map((r) => r.title)
    const forH = (await listByGoal(h)).map((r) => r.title)
    expect(forG).toEqual(['Inherits'])
    expect(forH).toEqual(['Own goal'])

    const board = Object.fromEntries((await listTasks()).map((t) => [t.title, t]))
    expect(board.Inherits.goal_ref).toBe(g)
    expect(board.Inherits.goal_title).toBe('G')
    expect(board.Inherits.own_goal_ref).toBeNull()
    expect(board.Inherits.project_goal_ref).toBe(g)
    expect(board['Own goal'].goal_ref).toBe(h)
    expect(board['Own goal'].own_goal_ref).toBe(h)
    expect(board['No project'].goal_ref).toBeNull()
  })
})

describe('complete on a repeating task', () => {
  // v1.2 phase 6b. Far enough ahead that today never overtakes the due date.
  it('writes one next instance with the rule and the skills, however often it is completed', async () => {
    const written = await callTool(
      'tasks',
      'write',
      { title: 'Use the card credits', due_on: '2030-01-31', repeat: { every: 'month', on: [31] } },
      { source: 'ui' },
    )
    const id = (written as { result: { id: string } }).result.id
    await db().query(
      `insert into core.skill_links (entity_ref, skill_id, confidence, classified_by, is_manual)
       select id, 'personal-finance', 1, 'human', true from core.entities
        where module = 'tasks' and entity_id = $1
       on conflict (entity_ref, skill_id) do nothing`,
      [id],
    )

    await callTool('tasks', 'complete', { id }, { source: 'ui' })
    await callTool('tasks', 'complete', { id, done: false }, { source: 'ui' })
    await callTool('tasks', 'complete', { id }, { source: 'ui' })

    const { rows } = await db().query<{ id: string; due_on: string; repeat: unknown; status: string }>(
      `select id, due_on::text, repeat, status from tasks.task where repeat_from = $1`,
      [id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ due_on: '2030-02-28', status: 'open', repeat: { every: 'month', on: [31] } })

    const links = await db().query<{ is_manual: boolean }>(
      `select l.is_manual from core.skill_links l join core.entities e on e.id = l.entity_ref
        where e.entity_id = $1 and l.skill_id = 'personal-finance'`,
      [rows[0].id],
    )
    expect(links.rows).toEqual([{ is_manual: false }])
  })

  it('writes nothing for a one-off task', async () => {
    const written = await callTool('tasks', 'write', { title: 'Renew passport' }, { source: 'ui' })
    const id = (written as { result: { id: string } }).result.id
    await callTool('tasks', 'complete', { id }, { source: 'ui' })
    const { rows } = await db().query(`select 1 from tasks.task where repeat_from = $1`, [id])
    expect(rows).toHaveLength(0)
  })

  it('writes the next instance when the weekly review drops it, and not for a row it did not close', async () => {
    const written = await callTool(
      'tasks',
      'write',
      { title: 'Water the plants', due_on: '2030-01-06', repeat: { every: 'week' } },
      { source: 'ui' },
    )
    const id = (written as { result: { id: string } }).result.id
    const apply = getModule('tasks')!.review!.apply!
    await apply({ carry: [], carryTo: '2030-01-07', drop: [id], values: {} })
    // Already done now, so a second drop closes nothing and writes nothing.
    await apply({ carry: [], carryTo: '2030-01-07', drop: [id], values: {} })

    const { rows } = await db().query<{ due_on: string }>(
      `select due_on::text from tasks.task where repeat_from = $1`,
      [id],
    )
    expect(rows).toEqual([{ due_on: '2030-01-13' }])
  })

  it('refuses a rule whose days can never come', async () => {
    for (const repeat of [
      { every: 'week', on: [7] },
      { every: 'month', on: [0] },
      { every: 'month', on: [1, 15] },
      { every: 'day', on: [1] },
    ]) {
      await expect(
        callTool('tasks', 'write', { title: 'Bad rule', repeat }, { source: 'ui' }),
      ).rejects.toThrow()
    }
  })
})


describe('review_task', () => {
  const ui = { source: 'ui' as const }
  const run = async (input: Record<string, unknown>) => {
    const r = await callTool('tasks', 'review_task', input, ui)
    return (r as { result: { id: string | null } }).result.id
  }
  const open = async () =>
    (
      await db().query<{ id: string; due_on: string; repeat: unknown }>(
        `select id, due_on::text, repeat from tasks.task where title = 'Weekly review' and status = 'open'`,
      )
    ).rows

  it('writes one open task, moves it, follows it past a completion and deletes only the open one', async () => {
    const first = await run({ action: 'set', day: 0, due_on: '2026-10-18' })
    expect(await open()).toEqual([{ id: first, due_on: '2026-10-18', repeat: { every: 'week', on: [0] } }])

    // A second set moves the same row rather than writing another.
    expect(await run({ action: 'set', day: 5, due_on: '2026-10-16' })).toBe(first)
    expect((await open())[0].due_on).toBe('2026-10-16')

    await callTool('tasks', 'complete', { id: first }, ui)
    const next = await run({ action: 'find' })
    expect(next).not.toBe(first)
    expect(next).toBe((await open())[0].id)

    await run({ action: 'off' })
    expect(await open()).toEqual([])
    const done = await db().query(`select 1 from tasks.task where id = $1 and status = 'done'`, [first])
    expect(done.rowCount).toBe(1)

    // On again starts a new chain; the done root gives up the key.
    const again = await run({ action: 'set', day: 0, due_on: '2026-10-25' })
    expect(again).not.toBe(first)
    expect(await open()).toHaveLength(1)

    // Its registry rows are parked unclassified; the skills tests must not find them.
    await db().query('delete from tasks.task')
    await db().query(`delete from core.entities where module = 'tasks'`)
  })
})
