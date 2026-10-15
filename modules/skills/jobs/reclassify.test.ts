import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const complete = vi.fn()
vi.mock('@/core/llm', () => ({ complete: (...args: unknown[]) => complete(...args) }))

const { db } = await import('@/core/db')
const { reclassify } = await import('./reclassify')

beforeEach(() => complete.mockReset())
afterEach(async () => {
  await db().query('delete from core.skill_links')
  await db().query('delete from core.events')
  await db().query('delete from core.entities')
})
afterAll(async () => {
  await db().end()
})

/** An entity parked exactly as classify() leaves one the rules could not place. */
async function parked(title: string): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into core.entities (module, entity_type, entity_id, title, body)
     values ('notes', 'note', gen_random_uuid()::text, $1, '') returning id`,
    [title],
  )
  const id = rows[0].id
  await db().query(
    `insert into core.skill_links (entity_ref, skill_id, confidence, classified_by)
     values ($1, 'unclassified', 0, 'unclassified')`,
    [id],
  )
  return id
}

async function linksFor(id: string): Promise<{ skill_id: string; classified_by: string }[]> {
  const { rows } = await db().query<{ skill_id: string; classified_by: string }>(
    `select skill_id, classified_by from core.skill_links where entity_ref = $1 order by skill_id`,
    [id],
  )
  return rows
}

it('places a parked row and clears the marker', async () => {
  const id = await parked('Refactored the deployment pipeline')
  complete.mockResolvedValue('[{"ref":0,"skill_id":"devops","confidence":0.8}]')

  const result = await reclassify()

  expect(result.parked).toBe(1)
  expect(result.classified).toBe(1)
  expect(await linksFor(id)).toEqual([
    { skill_id: 'devops', classified_by: 'model:claude-haiku-4-5' },
  ])
})

// The whole point of the change: the tree and the instructions are sent once
// for the batch instead of once per entity.
it('asks once for a whole batch', async () => {
  const ids = []
  for (let i = 0; i < 5; i++) ids.push(await parked(`Item number ${i}`))
  complete.mockResolvedValue(
    JSON.stringify(ids.map((_, ref) => ({ ref, skill_id: 'devops', confidence: 0.5 }))),
  )

  const result = await reclassify()

  expect(complete).toHaveBeenCalledTimes(1)
  expect(result.calls).toBe(1)
  expect(result.classified).toBe(5)
})

it('leaves a row parked when the model places nothing on it', async () => {
  const id = await parked('Something the tree has no word for')
  complete.mockResolvedValue('[]')

  const result = await reclassify()

  expect(result.unplaced).toBe(1)
  expect(result.classified).toBe(0)
  expect(await linksFor(id)).toEqual([
    { skill_id: 'unclassified', classified_by: 'unclassified' },
  ])
})

// An id the tree does not contain is the failure mode a prompt cannot prevent,
// so it is filtered rather than asked about.
it('discards a skill id that is not in the tree', async () => {
  const id = await parked('Invented a skill')
  complete.mockResolvedValue('[{"ref":0,"skill_id":"underwater_basket_weaving","confidence":1}]')

  await reclassify()

  expect(await linksFor(id)).toEqual([
    { skill_id: 'unclassified', classified_by: 'unclassified' },
  ])
})

// A model that is unreachable, capped, or answering with prose instead of JSON
// all reach the same place: one retry, then leave the rest parked for tomorrow
// rather than spend nine more calls learning the same thing.
it('stops after one failed batch instead of burning the rest', async () => {
  for (let i = 0; i < 45; i++) await parked(`Item ${i}`)
  complete.mockResolvedValue('I am afraid I cannot help with that.')

  const result = await reclassify()

  // Two attempts inside the first batch, then the run gives up. Three batches
  // were available, so without the break this would be six calls.
  expect(complete).toHaveBeenCalledTimes(2)
  expect(result.calls).toBe(1)
  expect(result.classified).toBe(0)
  expect(result.parked).toBe(45)
})

// A hand made decision is not a job's to take back.
it('never overwrites a manual link', async () => {
  const id = await parked('Wrote some typescript')
  await db().query(
    `update core.skill_links set is_manual = true, skill_id = 'writing'
      where entity_ref = $1`,
    [id],
  )
  complete.mockResolvedValue('[{"ref":0,"skill_id":"devops","confidence":0.9}]')

  const result = await reclassify()

  // The manual row is not parked any more, so there is nothing for the job.
  expect(result.parked).toBe(0)
  expect(await linksFor(id)).toEqual([{ skill_id: 'writing', classified_by: 'unclassified' }])
})
