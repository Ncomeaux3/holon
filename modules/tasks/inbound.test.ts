import { afterAll, afterEach, describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const { db } = await import('@/core/db')
const { toReminders } = await import('@/integrations/apple_reminders/client')
// Through the registry, not the file: writing a task calls register(), which
// resolves the classifier through modules/_index.
const { getModule } = await import('@/core/modules')

const post = (reminders: unknown[]) => getModule('tasks')!.inbound!.apple_reminders({ reminders })

const rows = async () =>
  (
    await db().query<{
      title: string
      notes: string
      due_on: string | null
      due_at: string | null
      status: string
      project: string | null
      priority: string
    }>(
      `select t.title, t.notes, t.due_on::text, to_char(t.due_at, 'HH24:MI') as due_at, t.status,
              p.name as project, t.priority
         from tasks.task t left join tasks.project p on p.id = t.project_id
        where t.source = 'apple_reminders'
        order by t.title`,
    )
  ).rows

/**
 * Age every Apple row, as days of not being posted would. The table's
 * `set_updated_at` trigger rewrites the column on any update, which is exactly
 * what makes it mean "last seen in a post", so the test turns it off for this
 * one statement rather than the code keeping a second column.
 */
async function backdate(days: number) {
  await db().query(`alter table tasks.task disable trigger set_updated_at`)
  await db().query(
    `update tasks.task set updated_at = now() - ($1 || ' days')::interval where source = 'apple_reminders'`,
    [days],
  )
  await db().query(`alter table tasks.task enable trigger set_updated_at`)
}

describe('toReminders', () => {
  it('reads the date and time as the owner wrote them, offset and all', () => {
    expect(toReminders({ reminders: [{ id: 'x-1', title: 'Call the vet', due: '2026-10-01T09:00:00-05:00' }] })).toEqual(
      [{ externalId: 'x-1', title: 'Call the vet', dueOn: '2026-10-01', dueAt: '09:00', notes: '', list: '' }],
    )
  })

  it('takes a bare date as a whole day', () => {
    expect(toReminders({ reminders: [{ id: 'x-2', title: 'Bins', due: '2026-10-02' }] })[0]).toMatchObject({
      dueOn: '2026-10-02',
      dueAt: null,
    })
  })

  it('skips a reminder with no id, which there is no way to match again', () => {
    expect(toReminders({ reminders: [{ id: '', title: 'Ghost' }] })).toEqual([])
  })

  it('names an untitled reminder rather than writing an empty task', () => {
    expect(toReminders({ reminders: [{ id: 'x-3' }] })[0].title).toBe('Reminder')
  })
})

describe('the tasks inbound seam', () => {
  afterEach(async () => {
    await db().query(`delete from core.entities where module = 'tasks' and entity_type = 'task'`)
    await db().query(`delete from tasks.task where source = 'apple_reminders'`)
    await db().query(`delete from tasks.project where name in ('Groceries', 'Home')`)
  })

  afterAll(async () => {
    await db().end()
  })

  it('writes a reminder as a task, with its list as the project', async () => {
    await post([{ id: 'r1', title: 'Buy milk', due: '2026-10-05T17:30:00-05:00', notes: 'Whole', list: 'Groceries' }])
    expect(await rows()).toEqual([
      {
        title: 'Buy milk',
        notes: 'Whole',
        due_on: '2026-10-05',
        due_at: '17:30',
        status: 'open',
        project: 'Groceries',
        priority: 'P2',
      },
    ])
  })

  it('registers the task, so it reaches search and the skill tree', async () => {
    await post([{ id: 'r1', title: 'Buy milk' }])
    const { rows: entities } = await db().query<{ title: string }>(
      `select title from core.entities where module = 'tasks' and entity_type = 'task' and title = 'Buy milk'`,
    )
    expect(entities).toHaveLength(1)
  })

  it('updates the row Apple owns rather than writing a second one', async () => {
    await post([{ id: 'r1', title: 'Buy milk', list: 'Groceries' }])
    await post([{ id: 'r1', title: 'Buy oat milk', due: '2026-10-06', list: 'Groceries' }])
    expect(await rows()).toEqual([
      expect.objectContaining({ title: 'Buy oat milk', due_on: '2026-10-06', project: 'Groceries' }),
    ])
  })

  // SPEC: a manual field is never overwritten. What Apple sends wins; what it
  // leaves out keeps what is here.
  it('keeps notes and a due date typed here when the reminder carries none', async () => {
    await post([{ id: 'r1', title: 'Buy milk' }])
    await db().query(
      `update tasks.task set notes = 'The oat one', due_on = '2026-10-09', due_at = '17:30'
        where source = 'apple_reminders'`,
    )
    await post([{ id: 'r1', title: 'Buy milk' }])
    expect(await rows()).toEqual([
      expect.objectContaining({ notes: 'The oat one', due_on: '2026-10-09', due_at: '17:30' }),
    ])
  })

  it('lets what Apple does send win', async () => {
    await post([{ id: 'r1', title: 'Buy milk', notes: 'Skimmed', due: '2026-10-05' }])
    await post([{ id: 'r1', title: 'Buy milk', notes: 'Whole', due: '2026-10-06' }])
    expect(await rows()).toEqual([expect.objectContaining({ notes: 'Whole', due_on: '2026-10-06' })])
  })

  it('leaves the fields POS owns alone', async () => {
    await post([{ id: 'r1', title: 'Buy milk' }])
    await db().query(
      `update tasks.task set priority = 'P1', estimated_minutes = 20 where source = 'apple_reminders'`,
    )
    await post([{ id: 'r1', title: 'Buy milk' }])
    const { rows: kept } = await db().query<{ priority: string; estimated_minutes: number }>(
      `select priority, estimated_minutes from tasks.task where source = 'apple_reminders'`,
    )
    expect(kept[0]).toEqual({ priority: 'P1', estimated_minutes: 20 })
  })

  // The reminder is gone from Apple: done there, or deleted. Two posts' worth
  // of absence rather than one, so a Shortcut run that half fails is not a
  // list of tasks silently closed.
  it('completes a task whose reminder has been missing for two days', async () => {
    await post([{ id: 'r1', title: 'Buy milk' }])
    await backdate(3)
    await post([{ id: 'r2', title: 'Post the parcel' }])
    expect(await rows()).toEqual([
      expect.objectContaining({ title: 'Buy milk', status: 'done' }),
      expect.objectContaining({ title: 'Post the parcel', status: 'open' }),
    ])
  })

  it('leaves a reminder that is still posted open, however old the task is', async () => {
    await post([{ id: 'r1', title: 'Buy milk' }])
    await backdate(3)
    await post([{ id: 'r1', title: 'Buy milk' }])
    expect(await rows()).toEqual([expect.objectContaining({ status: 'open' })])
  })

  it('emits the completion event, so a swept task earns what finishing it earns', async () => {
    await post([{ id: 'r1', title: 'Buy milk' }])
    await backdate(3)
    await post([])
    const { rows: events } = await db().query<{ event_type: string }>(
      `select e.event_type from core.events e
         join core.entities n on n.id = e.entity_ref
        where e.module = 'tasks' and e.event_type = 'task_completed' and n.title = 'Buy milk'`,
    )
    expect(events).toHaveLength(1)
  })

  it('reads one reminder listed twice in a payload as one task', async () => {
    await post([
      { id: 'r1', title: 'Buy milk' },
      { id: 'r1', title: 'Buy milk' },
    ])
    expect(await rows()).toHaveLength(1)
  })

  it('never reopens a task completed here', async () => {
    await post([{ id: 'r1', title: 'Buy milk' }])
    await db().query(
      `update tasks.task set status = 'done', completed_at = now() where source = 'apple_reminders'`,
    )
    await post([{ id: 'r1', title: 'Buy milk' }])
    expect(await rows()).toEqual([expect.objectContaining({ status: 'done' })])
  })
})
