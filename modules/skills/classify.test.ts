import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const complete = vi.fn()
vi.mock('@/core/llm', () => ({ complete: (...args: unknown[]) => complete(...args) }))

const { db } = await import('@/core/db')
const { classify, matchByRules } = await import('./classify')
const { loadYaml } = await import('./tree')
const { default: manifest } = await import('./manifest')

const link = (entityRef: string, skillId: string) =>
  manifest.tools.link.run({ entityRef, skillId }, { source: 'ui' })
const unlink = (entityRef: string, skillId: string) =>
  manifest.tools.unlink.run({ entityRef, skillId }, { source: 'ui' })

// matchByRules takes the tree explicitly now that overrides can change it, so
// the rule tests pass the committed default.
const tree = loadYaml()
const rules = (text: string) => matchByRules(text, tree)

async function anEntity(title: string): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into core.entities (module, entity_type, entity_id, title)
     values ('notes', 'note', gen_random_uuid()::text, $1) returning id`,
    [title],
  )
  return rows[0].id
}

const linksFor = async (ref: string) =>
  (
    await db().query<{ skill_id: string; classified_by: string; confidence: string; is_manual: boolean }>(
      'select skill_id, classified_by, confidence, is_manual from core.skill_links where entity_ref = $1 order by skill_id',
      [ref],
    )
  ).rows

beforeEach(() => {
  complete.mockReset()
})
afterEach(async () => {
  await db().query('delete from core.entities')
})
afterAll(async () => {
  await db().end()
})

describe('loadYaml', () => {
  it('parses the tree and gives every node a unique id', () => {
    const nodes = loadYaml()
    expect(nodes.length).toBeGreaterThan(20)
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length)
  })

  it('points every parent at a node that exists', () => {
    const nodes = loadYaml()
    const ids = new Set(nodes.map((n) => n.id))
    for (const n of nodes) {
      if (n.parent) expect(ids, `${n.id} parent`).toContain(n.parent)
    }
  })
})

describe('matchByRules', () => {
  it('matches a keyword regardless of case', () => {
    expect(rules('Deadlift form check')).toContain('strength')
    expect(rules('DEADLIFT')).toContain('strength')
  })

  it('matches on word boundaries, not substrings', () => {
    // 'ran' is an endurance keyword; 'branch' and 'grandiose' must not hit it.
    expect(rules('merged the branch')).not.toContain('endurance')
    expect(rules('ran a 5k')).toContain('endurance')
  })

  it("places Apple's strength workout name by rule, not by the nightly model", () => {
    expect(rules('Traditional Strength Training')).toEqual(['strength'])
  })

  it('can return several skills for one piece of text', () => {
    const hits = rules('Wrote a postgres migration and deployed it to vercel')
    expect(hits).toEqual(expect.arrayContaining(['sql', 'cloud']))
  })

  it('returns nothing for text with no keyword in it', () => {
    expect(rules('the quiet afternoon passed')).toEqual([])
  })

  it('matches multi word keywords', () => {
    expect(rules('spent the day on system design')).toContain('architecture')
  })
})

describe('classify', () => {
  it('writes a rule link with full confidence on a keyword hit, without calling the model', async () => {
    const ref = await anEntity('Deadlift form check')
    await classify(ref, 'Deadlift form check')

    const links = await linksFor(ref)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ skill_id: 'strength', classified_by: 'rule', is_manual: false })
    expect(Number(links[0].confidence)).toBe(1)
    expect(complete).not.toHaveBeenCalled()
  })

  // The model no longer runs here. Anything the rules miss parks under
  // `unclassified` and the nightly reclassify job places it, so a write never
  // waits on a round trip and re-registering unchanged text costs nothing.
  // The model half is covered in jobs/reclassify.test.ts.
  it('parks what the rules miss without calling the model', async () => {
    const ref = await anEntity('The quiet afternoon passed')
    await classify(ref, 'The quiet afternoon passed')

    expect(complete).not.toHaveBeenCalled()
    const links = await linksFor(ref)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ skill_id: 'unclassified', classified_by: 'unclassified' })
  })

  it('costs nothing to classify the same row twice', async () => {
    const ref = await anEntity('The quiet afternoon passed')
    await classify(ref, 'The quiet afternoon passed')
    await classify(ref, 'The quiet afternoon passed')

    expect(complete).not.toHaveBeenCalled()
    expect(await linksFor(ref)).toHaveLength(1)
  })

  // The rule that matters most: a human decision is never overwritten by a job.
  it('leaves a manual link alone even when the rules disagree', async () => {
    const ref = await anEntity('Deadlift form check')
    await db().query(
      `insert into core.skill_links (entity_ref, skill_id, confidence, classified_by, is_manual)
       values ($1, 'strength', 0.2, 'human', true)`,
      [ref],
    )

    await classify(ref, 'Deadlift form check')

    const links = await linksFor(ref)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ classified_by: 'human', is_manual: true })
    expect(Number(links[0].confidence)).toBeCloseTo(0.2)
  })

  it('is idempotent: classifying twice does not duplicate links', async () => {
    const ref = await anEntity('Deadlift form check')
    await classify(ref, 'Deadlift form check')
    await classify(ref, 'Deadlift form check')
    expect(await linksFor(ref)).toHaveLength(1)
  })
})

describe('the unclassified marker', () => {
  it('is cleared once rules find a real skill', async () => {
    const ref = await anEntity('Later matched by a rule')

    // Stand in for a row classified while the model was unreachable.
    await db().query(
      `insert into core.skill_links (entity_ref, skill_id, confidence, classified_by)
       values ($1, 'unclassified', 0, 'unclassified')`,
      [ref],
    )

    await classify(ref, 'typescript refactor')

    const { rows } = await db().query<{ skill_id: string }>(
      'select skill_id from core.skill_links where entity_ref = $1',
      [ref],
    )
    // It is a parking space, not a skill: leaving it would put it in the tree
    // forever and give it XP of its own.
    expect(rows.map((r) => r.skill_id)).not.toContain('unclassified')
    expect(rows.length).toBeGreaterThan(0)
  })

  it('is left alone when the owner set it by hand', async () => {
    const ref = await anEntity('Deliberately parked')
    await db().query(
      `insert into core.skill_links (entity_ref, skill_id, confidence, classified_by, is_manual)
       values ($1, 'unclassified', 0, 'unclassified', true)`,
      [ref],
    )

    await classify(ref, 'typescript refactor')

    const { rows } = await db().query<{ skill_id: string }>(
      `select skill_id from core.skill_links where entity_ref = $1 and skill_id = 'unclassified'`,
      [ref],
    )
    expect(rows).toHaveLength(1)
  })
})

// The picker on every entity drawer. A link made by hand is a manual row, so
// the same rule that protects a Skill Tree reassign protects it here.
describe('skills.link and skills.unlink', () => {
  it('a hand-made link survives classify() disagreeing with it', async () => {
    const ref = await anEntity('Deadlift form check')
    await link(ref, 'negotiation')

    await classify(ref, 'Deadlift form check')

    const links = await linksFor(ref)
    expect(links.map((l) => l.skill_id)).toEqual(['negotiation', 'strength'])
    expect(links[0]).toMatchObject({ classified_by: 'human', is_manual: true })
    expect(Number(links[0].confidence)).toBe(1)
  })

  it('linking a parked entity clears the unclassified marker', async () => {
    const ref = await anEntity('The quiet afternoon passed')
    await classify(ref, 'The quiet afternoon passed')

    await link(ref, 'writing')

    expect((await linksFor(ref)).map((l) => l.skill_id)).toEqual(['writing'])
  })

  it('unlink removes the row', async () => {
    const ref = await anEntity('Deadlift form check')
    await classify(ref, 'Deadlift form check')
    await link(ref, 'negotiation')

    await unlink(ref, 'negotiation')

    expect((await linksFor(ref)).map((l) => l.skill_id)).toEqual(['strength'])
  })
})
