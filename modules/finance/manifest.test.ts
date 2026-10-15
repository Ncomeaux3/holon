import { afterAll, afterEach, describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const { db } = await import('@/core/db')
const { default: manifest } = await import('./manifest')
const { getChartMonths, setChartMonths } = await import('./data')

// v1.2 phase 5c. Editing a rule is an insert and a delete, because
// (pattern, category_id) is unique. The order of those two is the whole of
// what these tests hold: the old rule outlives a failed insert, and it is gone
// before the back-file runs, or it can win its own replacement.

const writeRule = (input: { id?: string; pattern: string; category_id: string }) =>
  manifest.tools.write_rule.run(input, { source: 'ui' }) as Promise<{
    pattern: string
    moved: number
  }>

async function account(): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into finance.account (name, kind, source, external_id)
     values ('Card', 'credit', 'demo', 'manifest-card')
     on conflict (source, external_id) do update set name = excluded.name
     returning id`,
  )
  return rows[0].id
}

async function category(name: string): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `select id from finance.category where name = $1`,
    [name],
  )
  return rows[0].id
}

async function add(descriptor: string): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into finance.transaction
       (account_id, descriptor, merchant, amount_cents, occurred_on, source)
     values ($1, $2, lower($2), 1000, core.today(), 'demo')
     returning id`,
    [await account(), descriptor],
  )
  return rows[0].id
}

async function filedAs(id: string): Promise<string | null> {
  const { rows } = await db().query<{ name: string | null }>(
    `select c.name from finance.transaction t
       left join finance.category c on c.id = t.category_id
      where t.id = $1`,
    [id],
  )
  return rows[0].name
}

afterEach(async () => {
  await db().query(`delete from finance.transaction where source = 'demo'`)
  await db().query(`delete from finance.account where source = 'demo'`)
  await db().query(`delete from finance.category_rule where is_manual = true`)
})
afterAll(async () => {
  await db().end()
})

describe('finance.write_rule', () => {
  it('writes a rule and back-files the rows it matches', async () => {
    const one = await add('PUBLIX #1234')
    const two = await add('PUBLIX #0087')

    const result = await writeRule({ pattern: 'PUBLIX', category_id: await category('Groceries') })
    expect(result).toMatchObject({ pattern: 'publix', moved: 2 })
    expect(await filedAs(one)).toBe('Groceries')
    expect(await filedAs(two)).toBe('Groceries')
  })

  it('moves the rows when the rule moves to another category, leaving one rule', async () => {
    const row = await add('PUBLIX #1234')
    await writeRule({ pattern: 'publix', category_id: await category('Groceries') })

    const { rows } = await db().query<{ id: string }>(
      `select id from finance.category_rule where pattern = 'publix'`,
    )
    // The old rule has to be gone before the back-file: two rules of the same
    // pattern are the same length, so the one being replaced could win.
    await writeRule({ id: rows[0].id, pattern: 'publix', category_id: await category('Dining') })
    expect(await filedAs(row)).toBe('Dining')

    const { rows: after } = await db().query(
      `select 1 from finance.category_rule where pattern = 'publix'`,
    )
    expect(after).toHaveLength(1)
  })

  it('keeps the rule when nothing about it changed', async () => {
    await add('PUBLIX #1234')
    const groceries = await category('Groceries')
    await writeRule({ pattern: 'publix', category_id: groceries })
    const { rows } = await db().query<{ id: string }>(
      `select id from finance.category_rule where pattern = 'publix'`,
    )

    // Same pattern, same category: the insert lands on that very row, and
    // deleting by id afterwards would remove the rule the owner just saved.
    await writeRule({ id: rows[0].id, pattern: 'publix', category_id: groceries })
    const { rows: after } = await db().query(
      `select 1 from finance.category_rule where pattern = 'publix'`,
    )
    expect(after).toHaveLength(1)
  })

  it('refuses a pattern too short to be safe', async () => {
    // Two characters would match half the ledger, and a bad rule mis-files
    // quietly, which is the failure worth spending code to avoid.
    await expect(writeRule({ pattern: 'ab', category_id: await category('Dining') })).rejects.toThrow(
      /at least 3 letters/,
    )
    await expect(writeRule({ pattern: '12345', category_id: await category('Dining') })).rejects.toThrow()
  })
})

describe('finance.delete_rule', () => {
  it('hands the rows to whatever matches next', async () => {
    const row = await add('AMAZON PRIME 2H4KL')
    await writeRule({ pattern: 'amazon', category_id: await category('Shopping') })
    await writeRule({ pattern: 'amazon prime', category_id: await category('Subscriptions') })
    expect(await filedAs(row)).toBe('Subscriptions')

    const { rows } = await db().query<{ id: string }>(
      `select id from finance.category_rule where pattern = 'amazon prime'`,
    )
    const result = (await manifest.tools.delete_rule.run({ id: rows[0].id }, { source: 'ui' })) as {
      moved: number
    }
    expect(result.moved).toBe(1)
    expect(await filedAs(row)).toBe('Shopping')
  })
})

describe('finance.set_cash_flow_accounts', () => {
  it('switches the listed accounts on, every other open one off, and leaves archived ones alone', async () => {
    // The tool speaks for every open account, so the local rows it is not
    // about are put back afterwards.
    const { rows: before } = await db().query<{ id: string; in_cash_flow: boolean }>(
      `select id, in_cash_flow from finance.account`,
    )
    const { rows } = await db().query<{ id: string; external_id: string }>(
      `insert into finance.account (name, kind, in_cash_flow, archived, source, external_id) values
         ('Checking', 'checking', false, false, 'demo', 'cash-on'),
         ('Brokerage', 'brokerage', true, false, 'demo', 'cash-off'),
         ('Old card', 'credit', true, true, 'demo', 'cash-archived')
       returning id, external_id`,
    )
    const id = (ext: string) => rows.find((r) => r.external_id === ext)!.id

    try {
      await manifest.tools.set_cash_flow_accounts.run({ account_ids: [id('cash-on')] }, { source: 'ui' })
      const { rows: after } = await db().query<{ external_id: string; in_cash_flow: boolean }>(
        `select external_id, in_cash_flow from finance.account where source = 'demo' order by external_id`,
      )
      expect(after).toEqual([
        { external_id: 'cash-archived', in_cash_flow: true },
        { external_id: 'cash-off', in_cash_flow: false },
        { external_id: 'cash-on', in_cash_flow: true },
      ])
    } finally {
      for (const r of before) {
        await db().query(`update finance.account set in_cash_flow = $2 where id = $1`, [r.id, r.in_cash_flow])
      }
    }
  })

  it('refuses an id that is not a uuid', () => {
    expect(manifest.tools.set_cash_flow_accounts.input.safeParse({ account_ids: ['nope'] }).success).toBe(false)
  })
})

describe('finance.set_chart_months', () => {
  it('refuses anything outside 3, 6, 12 or 24 and accepts the set', () => {
    const parse = (months: unknown) => manifest.tools.set_chart_months.input.safeParse({ months }).success
    expect(parse(1)).toBe(false)
    expect(parse(5)).toBe(false)
    expect(parse(36)).toBe(false)
    expect(parse(3)).toBe(true)
    expect(parse(6)).toBe(true)
    expect(parse(12)).toBe(true)
    expect(parse(24)).toBe(true)
  })

  it('stores the value it is given', async () => {
    const before = await getChartMonths()
    try {
      await manifest.tools.set_chart_months.run({ months: 24 }, { source: 'ui' })
      expect(await getChartMonths()).toBe(24)
    } finally {
      await setChartMonths(before)
    }
  })
})

// v1.2 phase 10b. The trip tag has its own provenance: the rule suggests, the
// owner's answer (confirm, change or clear) is never overwritten by a rerun.
describe('finance trip spend', () => {
  const trip = async (key: string) => {
    const { rows } = await db().query<{ id: string }>(
      `insert into core.entities (module, entity_type, entity_id, title)
       values ('travel', 'trip', $1, 'Test trip')
       on conflict (module, entity_type, entity_id) do update set title = excluded.title
       returning id`,
      [key],
    )
    return rows[0].id
  }
  const charge = async (descriptor: string, on: string, cents = 1000) => {
    const { rows } = await db().query<{ id: string }>(
      `insert into finance.transaction (account_id, descriptor, merchant, amount_cents, occurred_on, source)
       values ($1, $2, lower($2), $3, $4, 'demo') returning id`,
      [await account(), descriptor, cents, on],
    )
    return rows[0].id
  }
  const tagOf = async (id: string) =>
    (
      await db().query<{ trip_ref: string | null; trip_classified_by: string | null }>(
        `select trip_ref, trip_classified_by from finance.transaction where id = $1`,
        [id],
      )
    ).rows[0]
  const places = [{ name: 'Ghent, Belgium', from: '2026-05-11', to: '2026-05-15' }]

  afterAll(async () => {
    await db().query(`delete from core.entities where module = 'travel' and entity_id like 'manifest-trip-%'`)
  })

  it('tags a charge in the city on the dates, and the spend seam sums it', async () => {
    const ref = await trip('manifest-trip-1')
    const hit = await charge('GRAVENSTEEN CAFE GHENT', '2026-05-12', 4200)
    const miss = await charge('GRAVENSTEEN CAFE GHENT', '2026-05-22')
    await manifest.tools.tag_trip.run({ trip_ref: ref, places }, { source: 'ui' })
    expect(await tagOf(hit)).toEqual({ trip_ref: ref, trip_classified_by: 'rule' })
    expect((await tagOf(miss)).trip_ref).toBeNull()
    expect(await manifest.spend!([ref])).toEqual({ [ref]: { cents: 4200, count: 1 } })
  })

  it('never retags a row the owner cleared', async () => {
    const ref = await trip('manifest-trip-2')
    const row = await charge('CAFE GHENT', '2026-05-13')
    await manifest.tools.tag_trip.run({ trip_ref: ref, places }, { source: 'ui' })
    await manifest.tools.set_trip.run({ id: row, trip_ref: null }, { source: 'ui' })
    await manifest.tools.tag_trip.run({ trip_ref: ref, places }, { source: 'ui' })
    expect(await tagOf(row)).toEqual({ trip_ref: null, trip_classified_by: 'manual' })
    expect(await manifest.spend!([ref])).toEqual({})
  })

  it('drops its own suggestions when the dates move', async () => {
    const ref = await trip('manifest-trip-3')
    const row = await charge('GHENT TAXI', '2026-05-14')
    await manifest.tools.tag_trip.run({ trip_ref: ref, places }, { source: 'ui' })
    await manifest.tools.tag_trip.run(
      { trip_ref: ref, places: [{ ...places[0], from: '2026-06-01', to: '2026-06-05' }] },
      { source: 'ui' },
    )
    expect(await tagOf(row)).toEqual({ trip_ref: null, trip_classified_by: null })
  })
})

describe('finance.move_trip_tags', () => {
  const trip = async (key: string) =>
    (
      await db().query<{ id: string }>(
        `insert into core.entities (module, entity_type, entity_id, title)
         values ('travel', 'trip', $1, 'Test trip')
         on conflict (module, entity_type, entity_id) do update set title = excluded.title
         returning id`,
        [key],
      )
    ).rows[0].id
  const tagged = async (ref: string, by: 'rule' | 'manual') =>
    (
      await db().query<{ id: string }>(
        `insert into finance.transaction
           (account_id, descriptor, merchant, amount_cents, occurred_on, source, trip_ref, trip_classified_by)
         values ($1, 'CAFE GHENT', 'cafe ghent', 1000, '2026-05-12', 'demo', $2, $3) returning id`,
        [await account(), ref, by],
      )
    ).rows[0].id
  const tagOf = async (id: string) =>
    (await db().query(`select trip_ref, trip_classified_by from finance.transaction where id = $1`, [id])).rows[0]

  afterAll(async () => {
    await db().query(`delete from core.entities where module = 'travel' and entity_id like 'move-trip-%'`)
  })

  it('a merge carries answers and suggestions to the trip it joins', async () => {
    const [from, to] = [await trip('move-trip-a'), await trip('move-trip-b')]
    const answer = await tagged(from, 'manual')
    const hint = await tagged(from, 'rule')
    await manifest.tools.move_trip_tags.run({ from, to }, { source: 'ui' })
    expect(await tagOf(answer)).toEqual({ trip_ref: to, trip_classified_by: 'manual' })
    expect(await tagOf(hint)).toEqual({ trip_ref: to, trip_classified_by: 'rule' })
  })

  it('a delete frees the rows for the rule', async () => {
    const from = await trip('move-trip-c')
    const answer = await tagged(from, 'manual')
    await manifest.tools.move_trip_tags.run({ from, to: null }, { source: 'ui' })
    expect(await tagOf(answer)).toEqual({ trip_ref: null, trip_classified_by: null })
  })
})

// v1.2 phase 11. Insurance posts a premium through write_recurring, keyed by
// (source, external_id); the detector's merchant key does not reach it.
describe('write_recurring and delete_recurring', () => {
  const post = (amount: number) =>
    manifest.tools.write_recurring.run(
      {
        source: 'insurance', external_id: 'manifest-policy', name: 'Manifest auto',
        amount_cents: amount, cadence: 'semiannual', last_charge_on: '2026-08-01',
        next_charge_on: '2027-02-01', category: 'Insurance premiums',
      },
      { source: 'ui' },
    )
  const row = async () =>
    (
      await db().query(
        `select r.amount_cents::int as amount, r.cadence, c.name as category
           from finance.recurring r left join finance.category c on c.id = r.category_id
          where r.source = 'insurance' and r.external_id = 'manifest-policy'`,
      )
    ).rows[0]

  afterAll(async () => {
    await db().query(`delete from finance.recurring where merchant = 'Manifest auto'`)
  })

  it('writes once and updates in place, beside a detection of the same name', async () => {
    await db().query(
      `insert into finance.recurring (merchant, amount_cents, cadence, last_charge_on, next_charge_on)
       values ('Manifest auto', 999, 'monthly', '2026-09-01', '2026-10-01')
       on conflict (merchant) where source = 'detected' do nothing`,
    )
    await post(60_000)
    await post(61_200)
    expect(await row()).toEqual({ amount: 61_200, cadence: 'semiannual', category: 'Insurance premiums' })
    const { rows } = await db().query(`select source from finance.recurring where merchant = 'Manifest auto' order by source`)
    expect(rows.map((r) => r.source)).toEqual(['detected', 'insurance'])
  })

  it('removes only the posted row', async () => {
    await post(61_200)
    await manifest.tools.delete_recurring.run({ source: 'insurance', external_id: 'manifest-policy' }, { source: 'ui' })
    expect(await row()).toBeUndefined()
    const { rows } = await db().query(`select 1 from finance.recurring where merchant = 'Manifest auto' and source = 'detected'`)
    expect(rows).toHaveLength(1)
  })

  it('refuses to post as the detector', () => {
    expect(() =>
      manifest.tools.write_recurring.run(
        { source: 'detected', external_id: 'x', name: 'x', amount_cents: 1, cadence: 'monthly', last_charge_on: '2026-01-01', next_charge_on: '2026-02-01' },
        { source: 'ui' },
      ),
    ).toThrow()
  })
})
