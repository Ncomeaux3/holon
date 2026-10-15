import { describe, expect, it } from 'vitest'
import { assertReadOnly, assertSchemas, capRows, runQuery } from './query'

// The role is the real guarantee: pos_readonly holds no write grant, so a
// mutation fails in Postgres whatever gets past this. These checks exist to
// refuse early with a message an agent can act on, and to close the one hole
// the role does not: a data-modifying CTE would be a legal SELECT statement.

describe('assertReadOnly', () => {
  const allowed = [
    'select 1',
    'SELECT * FROM notes.note',
    '  select id from core.entities where module = \'notes\'',
    'with recent as (select id from notes.note limit 5) select * from recent',
    'select count(*) from notes.note -- how many',
  ]

  for (const sql of allowed) {
    it(`allows: ${sql.trim().slice(0, 48)}`, () => {
      expect(() => assertReadOnly(sql)).not.toThrow()
    })
  }

  const refused: [string, string][] = [
    ['insert into notes.note (title) values (\'x\')', 'insert'],
    ['update notes.note set title = \'x\'', 'update'],
    ['delete from notes.note', 'delete'],
    ['drop table notes.note', 'drop'],
    ['truncate core.entities', 'truncate'],
    ['alter table notes.note add column x text', 'alter'],
    ['grant all on notes.note to anon', 'grant'],
    ['create table x (id int)', 'create'],
    ['select 1; delete from notes.note', 'more than one statement'],
    // Postgres really will run this, and it is a SELECT statement by shape.
    ['with gone as (delete from notes.note returning *) select * from gone', 'delete'],
    ['with added as (insert into notes.note (title) values (\'x\') returning *) select * from added', 'insert'],
    // A comment must not be able to hide the verb.
    ['select 1 /* */ ; /* */ drop table notes.note', 'more than one statement'],
    ['', 'empty'],
    ['   ', 'empty'],
    ['explain analyze select 1', 'must start'],
  ]

  for (const [sql, why] of refused) {
    it(`refuses: ${sql.trim().slice(0, 48) || '(empty)'}`, () => {
      expect(() => assertReadOnly(sql)).toThrow(new RegExp(why, 'i'))
    })
  }

  it('does not trip on a keyword inside a string literal', () => {
    expect(() => assertReadOnly("select * from notes.note where title = 'delete the thing'")).not.toThrow()
  })

  it('does not trip on a keyword inside an identifier', () => {
    expect(() => assertReadOnly('select created_at from notes.note')).not.toThrow()
  })
})

describe('capRows', () => {
  it('wraps rather than appending, so an inner limit cannot defeat it', () => {
    const capped = capRows('select * from notes.note limit 10000', 500)
    expect(capped).toContain('limit 500')
    // The original stays intact inside the wrapper: no rewriting of the query
    // the agent actually asked for.
    expect(capped).toContain('limit 10000')
  })

  it('caps a query with no limit of its own', () => {
    expect(capRows('select 1', 500)).toContain('limit 500')
  })
})

describe('runQuery', () => {
  it('returns rows for a legal read', async () => {
    const rows = await runQuery('select 1 as n')
    expect(rows).toEqual([{ n: 1 }])
  })

  it('refuses a write before it reaches the database', async () => {
    await expect(runQuery('delete from notes.note')).rejects.toThrow(/delete/i)
  })

  it('caps the number of rows returned', async () => {
    const rows = await runQuery('select generate_series(1, 5000) as n', { maxRows: 10 })
    expect(rows).toHaveLength(10)
  })

  it('surfaces a Postgres permission error rather than swallowing it', async () => {
    // A legal read that the role has no business doing. pg_authid holds the
    // password hashes and is superuser only, so the role stops it even though
    // nothing above objects to the statement. This is the layer that matters.
    await expect(runQuery('select * from pg_authid')).rejects.toThrow(/permission denied/i)
  })
})

describe('assertSchemas', () => {
  // pos_readonly can read every module schema, which is what core.search needs.
  // So a per-module query tool being scoped to its own module is this check and
  // nothing else. Without it `notes.query` reads the bank rows.
  const others = ['finance', 'health']

  it('rejects another module schema', () => {
    expect(() => assertSchemas('select * from finance.transactions', others)).toThrow(
      /may not read the finance schema/i,
    )
  })

  it('rejects it through quoted identifiers', () => {
    // The literal stripper removes quoted identifiers whole, so unquoting has
    // to happen first or this is a way straight past the check.
    expect(() => assertSchemas('select * from "finance"."transactions"', others)).toThrow(
      /finance/i,
    )
  })

  it('rejects a schema spelled with a Unicode escape identifier', () => {
    // Postgres resolves U&"\\0066inance" to finance. assertReadOnly refuses the
    // syntax outright, because a text check cannot see through it.
    expect(() => assertReadOnly('select * from U&"\\0066inance".transactions')).toThrow(
      /Unicode escape/i,
    )
  })

  it('rejects it inside a CTE', () => {
    expect(() =>
      assertSchemas('with t as (select * from health.vital) select * from t', others),
    ).toThrow(/health/i)
  })

  it('allows its own schema, core, and table aliases', () => {
    expect(() =>
      assertSchemas('select n.title from notes.note n join core.entities e on true', others),
    ).not.toThrow()
  })

  it('does not fire on a schema name that is only part of a word', () => {
    expect(() => assertSchemas('select * from notes.finance_note', others)).not.toThrow()
  })

  it('does not fire on the name inside a string literal', () => {
    expect(() =>
      assertSchemas("select * from notes.note where body = 'finance.transactions'", others),
    ).not.toThrow()
  })
})
