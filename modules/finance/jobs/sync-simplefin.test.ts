import { afterAll, afterEach, describe, expect, it } from 'vitest'
import type { Account } from '@/integrations/simplefin/client'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const { db } = await import('@/core/db')
const { storeAccount } = await import('./sync-simplefin')

// finance-charts phase 1. A column default cannot vary by kind, so the sync
// sets `in_cash_flow` on insert; after that it is the owner's switch and a
// nightly pull must not put it back.

const brokerage: Account = {
  id: 'test-sync-brokerage',
  name: 'Brokerage Individual',
  org: 'Demo Brokers',
  currency: 'USD',
  balanceCents: 100_000,
  balanceAt: new Date(),
  transactions: [],
}

const inCashFlow = async (id: string) =>
  (await db().query<{ in_cash_flow: boolean }>(`select in_cash_flow from finance.account where id = $1`, [id]))
    .rows[0].in_cash_flow

afterEach(async () => {
  await db().query(`delete from finance.account where external_id = $1`, [brokerage.id])
})
afterAll(async () => {
  await db().end()
})

describe('storeAccount', () => {
  it('starts a holding out of cash flow and keeps the owner’s switch on the next sync', async () => {
    const id = await storeAccount(brokerage, null)
    expect(await inCashFlow(id)).toBe(false)

    await db().query(`update finance.account set in_cash_flow = true where id = $1`, [id])
    await storeAccount({ ...brokerage, balanceCents: 120_000 }, null)
    expect(await inCashFlow(id)).toBe(true)
  })
})
