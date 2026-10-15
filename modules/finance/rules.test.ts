import { afterAll, afterEach, describe, expect, it } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const { db } = await import('@/core/db')
const { applyRule, groupUnfiled, refile, removeRule, unfiledMerchants } = await import('./rules')

// v1.2 phase 5c. A rule is only worth writing if it reaches the history: 607 of
// the owner's 622 rows had no category, and nothing here ever looked back.
// These are the three claims that makes: a back-file never touches a manual
// row, deleting a rule re-files rather than orphans, and money to a person is
// spending whatever the transfer patterns say.

async function account(): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into finance.account (name, kind, source, external_id)
     values ('Card', 'credit', 'demo', 'rules-card')
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

/** One transaction, uncategorised unless a category is named. */
async function add(
  descriptor: string,
  cents = 1_000,
  options: { category?: string; isManual?: boolean } = {},
): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into finance.transaction
       (account_id, descriptor, merchant, amount_cents, occurred_on, category_id, is_manual, source)
     values ($1, $2, lower($2), $3, core.today(), $4, $5, 'demo')
     returning id`,
    [
      await account(),
      descriptor,
      cents,
      options.category ? await category(options.category) : null,
      options.isManual ?? false,
    ],
  )
  return rows[0].id
}

async function rule(pattern: string, categoryName: string): Promise<string> {
  const { rows } = await db().query<{ id: string }>(
    `insert into finance.category_rule (category_id, pattern, is_manual, classified_by)
     values ($1, $2, true, 'human')
     on conflict (pattern, category_id) do update set is_manual = true
     returning id`,
    [await category(categoryName), pattern],
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

describe('applyRule', () => {
  it('back-files the history a new rule matches', async () => {
    const one = await add('PUBLIX #1234 BIRMINGHAM')
    const two = await add('PUBLIX #0087 HOMEWOOD')
    await rule('publix', 'Groceries')

    expect(await applyRule('publix')).toBe(2)
    expect(await filedAs(one)).toBe('Groceries')
    expect(await filedAs(two)).toBe('Groceries')
  })

  it('never writes a row the owner filed by hand', async () => {
    // The project's one inviolable flag. A back-file is the most tempting
    // place to break it, because it is the only job that reaches backwards.
    const manual = await add('PUBLIX #1234', 4_200, { category: 'Dining', isManual: true })
    const auto = await add('PUBLIX #0087')
    await rule('publix', 'Groceries')

    expect(await applyRule('publix')).toBe(1)
    expect(await filedAs(manual)).toBe('Dining')
    expect(await filedAs(auto)).toBe('Groceries')
  })

  it('leaves a row a longer rule already owns alone', async () => {
    // The rule set is re-run over every candidate rather than the new rule
    // being forced onto them, so a short pattern cannot steal a specific one's
    // rows on its way past.
    const prime = await add('AMAZON PRIME*2H4KL')
    await rule('amazon prime', 'Subscriptions')
    await applyRule('amazon prime')

    await rule('amazon', 'Shopping')
    await applyRule('amazon')
    expect(await filedAs(prime)).toBe('Subscriptions')
  })
})

describe('removeRule', () => {
  it('re-files the rows it held rather than orphaning them', async () => {
    const id = await add('AMAZON PRIME*2H4KL')
    await rule('amazon', 'Shopping')
    const specific = await rule('amazon prime', 'Subscriptions')
    await applyRule('amazon prime')
    expect(await filedAs(id)).toBe('Subscriptions')

    // The remaining rule takes it over. Clearing the row would be the bug.
    expect(await removeRule(specific)).toBe(1)
    expect(await filedAs(id)).toBe('Shopping')
  })

  it('clears a row no rule matches any more', async () => {
    const id = await add('ROSIES CANTINA')
    const only = await rule('rosies cantina', 'Dining')
    await applyRule('rosies cantina')
    expect(await filedAs(id)).toBe('Dining')

    expect(await removeRule(only)).toBe(1)
    expect(await filedAs(id)).toBeNull()
  })
})

describe('refile', () => {
  it('files money to a person as People, not as a transfer', async () => {
    // Money to a person read as `Account transfer`, whose kind is never
    // counted, so the money left and Finance said nothing had.
    const zelle = await add('ZELLE TRANSFER TO JANE DOE NWB4410', 96_500)
    const own = await add('ONLINE TRANSFER TO SAV ...5207', 50_000)

    await refile('transfer')
    expect(await filedAs(zelle)).toBe('People')
    expect(await filedAs(own)).toBe('Account transfer')
  })
})

describe('refile and the refund matcher', () => {
  it('keeps a refund that no rule matches, rather than clearing it for good', async () => {
    // matchRefund files money back into the category of the charge it refunds.
    // Re-running only the rules over that row would null it, and once the
    // charge fell out of the 90 day window nothing would file it again.
    // The merchants match, which is what makes it a refund of that charge; the
    // descriptors differ, so only the refund carries the stray rule's pattern.
    const card = await account()
    await db().query(
      `insert into finance.transaction
         (account_id, descriptor, merchant, amount_cents, occurred_on, category_id, source)
       values ($1, 'BISTRO 88', 'shared bistro', 5820, core.today(), $2, 'demo')`,
      [card, await category('Dining')],
    )
    const { rows } = await db().query<{ id: string }>(
      `insert into finance.transaction
         (account_id, descriptor, merchant, amount_cents, occurred_on, category_id, source)
       values ($1, 'CORNER CREDIT BISTRO 88', 'shared bistro', -5820, core.today(), $2, 'demo')
       returning id`,
      [card, await category('Dining')],
    )
    const refund = rows[0].id

    // A rule whose pattern the refund's descriptor also contains, then deleted.
    const stray = await rule('corner', 'Shopping')
    await applyRule('corner')
    expect(await filedAs(refund)).toBe('Shopping')
    await removeRule(stray)

    // Not null: the refund matcher is the second half of the same answer.
    expect(await filedAs(refund)).toBe('Dining')
  })
})

describe('groupUnfiled', () => {
  it('collapses one merchant’s store numbers onto the pattern a rule would use', () => {
    const groups = groupUnfiled([
      { descriptor: 'GREENLEAF #412', merchant: 'greenleaf 412', amountCents: 4_000, occurredOn: '2026-09-02', account: 'Checking' },
      { descriptor: 'GREENLEAF #118', merchant: 'greenleaf 118', amountCents: 2_000, occurredOn: '2026-09-01', account: 'Checking' },
      { descriptor: 'RIVER ROAST COFFEE', merchant: 'river roast coffee', amountCents: 900, occurredOn: '2026-09-01', account: 'Visa' },
    ])

    expect(groups.map((g) => [g.pattern, g.count, g.totalCents])).toEqual([
      ['greenleaf', 2, 6_000],
      ['river roast coffee', 1, 900],
    ])
  })

  it('still lists a descriptor with nothing learnable in it', () => {
    // All digits: learnFrom refuses it, and dropping the row would hide money.
    const row = { descriptor: '1234567', merchant: '1234567', amountCents: 500, occurredOn: '2026-09-01', account: 'Checking' }
    expect(groupUnfiled([row])).toEqual([
      {
        pattern: '1234567',
        label: '1234567',
        count: 1,
        totalCents: 500,
        rows: [{ descriptor: '1234567', amountCents: 500, occurredOn: '2026-09-01', account: 'Checking' }],
      },
    ])
  })

  it('keeps each transaction so money in and money out can be told apart', () => {
    // One institution, both directions: interest paid to the owner (negative,
    // money in) and interest charged (positive, money out). One rule files
    // both, so the drawer has to show them before the owner picks.
    const [group] = groupUnfiled([
      { descriptor: 'AMEX INTEREST CREDIT', merchant: 'amex interest credit', amountCents: -1_250, occurredOn: '2026-09-03', account: 'Savings' },
      { descriptor: 'AMEX INTEREST CREDIT', merchant: 'amex interest credit', amountCents: 300, occurredOn: '2026-08-03', account: 'Gold card' },
    ])
    expect(group.rows.map((r) => [r.occurredOn, r.account, r.amountCents])).toEqual([
      ['2026-09-03', 'Savings', -1_250],
      ['2026-08-03', 'Gold card', 300],
    ])
  })
})

describe('unfiledMerchants', () => {
  it('lists only what has no category and no manual flag', async () => {
    await add('PUBLIX #1234', 4_200)
    await add('PUBLIX #0087', 1_800)
    await add('CHIPOTLE 2291', 1_485, { category: 'Dining' })

    const unfiled = await unfiledMerchants()
    expect(unfiled.map((u) => u.pattern)).toEqual(['publix'])
    expect(unfiled[0]).toMatchObject({ count: 2, totalCents: 6_000 })
  })
})
