import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const complete = vi.fn()
vi.mock('@/core/llm', async () => {
  const actual = await vi.importActual<typeof import('@/core/llm')>('@/core/llm')
  return { ...actual, complete: (...args: unknown[]) => complete(...args) }
})

const { db } = await import('@/core/db')
const { fileByRules, fileUnfiledNightly, matchHubs, setHubs } = await import('./hubs')

async function hub(name: string, keywords: string[]): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into brain.hub (name, slug, keywords) values ($1, $1, $2) returning id`,
    [name, keywords],
  )
  return rows[0].id
}

async function note(title: string, body = ''): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into brain.note (title, body, slug, status) values ($1, $2, $1, 'published') returning id`,
    [title, body],
  )
  return rows[0].id
}

async function rowsFor(noteId: string) {
  const { rows } = await db().query<{ classified_by: string; is_manual: boolean }>(
    `select classified_by, is_manual from brain.note_hub where note_id = $1`,
    [noteId],
  )
  return rows
}

beforeEach(() => {
  complete.mockReset()
})
afterEach(async () => {
  await db().query('delete from brain.note_hub')
  await db().query('delete from brain.hub')
  await db().query('delete from brain.note')
  await db().query('delete from core.events')
  await db().query('delete from core.entities')
})
afterAll(async () => {
  await db().end()
})

describe('matchHubs', () => {
  const hubs = [
    { id: 'pg', keywords: ['postgres', 'sql'] },
    { id: 'run', keywords: ['running'] },
  ]

  it('matches a keyword on a word boundary, case insensitive', () => {
    expect(matchHubs('Notes on Postgres planning', hubs)).toEqual(['pg'])
  })

  it('does not match inside another word', () => {
    expect(matchHubs('mysql and outrunning', hubs)).toEqual([])
  })

  it('ignores a keyword inside a code fence or inline code', () => {
    expect(matchHubs('```\nselect * from postgres\n```\nand `running`', hubs)).toEqual([])
  })
})

describe('fileByRules', () => {
  it('files a note into every hub whose keyword it mentions', async () => {
    const pg = await hub('Postgres', ['postgres'])
    await hub('Running', ['running'])
    const id = await note('Postgres planner', 'how the planner picks a join')

    await fileByRules(id, 'Postgres planner', 'how the planner picks a join')

    const { rows } = await db().query<{ hub_id: string }>(
      `select hub_id from brain.note_hub where note_id = $1`,
      [id],
    )
    expect(rows.map((r) => r.hub_id)).toEqual([pg])
    expect((await rowsFor(id))[0]).toEqual({ classified_by: 'rule', is_manual: false })
  })

  it('leaves a manual row alone', async () => {
    const pg = await hub('Postgres', ['postgres'])
    const id = await note('Postgres planner')

    await setHubs(id, [pg])
    await fileByRules(id, 'Postgres planner', '')

    expect(await rowsFor(id)).toEqual([{ classified_by: 'manual', is_manual: true }])
  })
})

describe('fileUnfiledNightly', () => {
  it('makes no model call when nothing is unfiled', async () => {
    await hub('Postgres', ['postgres'])
    const id = await note('Postgres planner')
    await fileByRules(id, 'Postgres planner', '')

    expect(await fileUnfiledNightly()).toEqual({ filed: 0 })
    expect(complete).not.toHaveBeenCalled()
  })

  it('files a miss from the model answer', async () => {
    const pg = await hub('Postgres', ['postgres'])
    const id = await note('The planner', 'nothing rule-matchable here')
    complete.mockResolvedValue(JSON.stringify([{ note_id: id, hub_slug: 'Postgres', confidence: 0.8 }]))

    expect(await fileUnfiledNightly()).toEqual({ filed: 1 })
    expect(complete).toHaveBeenCalledTimes(1)
    const { rows } = await db().query<{ hub_id: string; classified_by: string }>(
      `select hub_id, classified_by from brain.note_hub where note_id = $1`,
      [id],
    )
    expect(rows).toEqual([{ hub_id: pg, classified_by: 'model' }])
  })
})
