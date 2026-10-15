import { randomBytes } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const create = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create }
  },
}))

const { db } = await import('./db')
const { complete, estimateCostCents, monthToDateCents, NotConnected, SoftCapExceeded } =
  await import('./llm')
const { setSetting } = await import('./settings')
const { saveCredentials } = await import('./integrations')

const reply = (text: string, input = 1000, output = 500) => ({
  content: [{ type: 'text', text }],
  usage: { input_tokens: input, output_tokens: output },
})

beforeEach(async () => {
  create.mockReset()
  create.mockResolvedValue(reply('ok'))
  // The key lives in core.connections now, not .env.
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64')
  await saveCredentials('anthropic', { api_key: 'sk-ant-test' })
})
afterEach(async () => {
  await db().query('delete from core.llm_calls')
  await db().query('delete from core.settings')
  await db().query('delete from core.connections')
})
afterAll(async () => {
  await db().end()
})

describe('estimateCostCents', () => {
  // Prices are cents per million tokens, so a million in plus a million out
  // should come to exactly the table rate.
  it('charges the table rate for a million tokens each way', () => {
    expect(estimateCostCents('claude-haiku-4-5', 1_000_000, 1_000_000)).toBeCloseTo(600)
    expect(estimateCostCents('claude-sonnet-5', 1_000_000, 1_000_000)).toBeCloseTo(1200)
  })

  it('scales down linearly for realistic call sizes', () => {
    // 1k in, 500 out on Haiku: 0.1c + 0.25c
    expect(estimateCostCents('claude-haiku-4-5', 1000, 500)).toBeCloseTo(0.35)
  })

  it('costs nothing for an empty call', () => {
    expect(estimateCostCents('claude-haiku-4-5', 0, 0)).toBe(0)
  })

  it('refuses a model that is not in the price table, rather than logging zero', () => {
    // @ts-expect-error deliberately outside the union
    expect(() => estimateCostCents('claude-imaginary-9', 1, 1)).toThrow(/price/i)
  })
})

describe('complete', () => {
  it('returns the text and writes one ledger row', async () => {
    const text = await complete({
      model: 'claude-haiku-4-5',
      purpose: 'classification',
      module: 'notes',
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(text).toBe('ok')
    const { rows } = await db().query(
      'select model, purpose, module, input_tokens, output_tokens, cost_cents from core.llm_calls',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      model: 'claude-haiku-4-5',
      purpose: 'classification',
      module: 'notes',
      input_tokens: 1000,
      output_tokens: 500,
    })
    expect(Number(rows[0].cost_cents)).toBeCloseTo(0.35)
  })

  it('refuses with NotConnected when Anthropic has never been connected', async () => {
    await db().query('delete from core.connections')
    await expect(
      complete({
        model: 'claude-haiku-4-5',
        purpose: 'classification',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow(NotConnected)
    expect(create).not.toHaveBeenCalled()
  })

  it('still records the call when the model returns no text', async () => {
    create.mockResolvedValue({ content: [], usage: { input_tokens: 10, output_tokens: 0 } })
    await expect(
      complete({
        model: 'claude-haiku-4-5',
        purpose: 'classification',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).resolves.toBe('')
    const { rows } = await db().query('select count(*)::int as n from core.llm_calls')
    expect(rows[0].n).toBe(1)
  })
})

describe('soft cap', () => {
  const overSpend = async () => {
    await setSetting('llm_soft_cap_cents', 100)
    await db().query(
      `insert into core.llm_calls (model, purpose, cost_cents) values ('claude-sonnet-5', 'research', 150)`,
    )
  }

  it('refuses research once month to date passes the cap', async () => {
    await overSpend()
    await expect(
      complete({
        model: 'claude-sonnet-5',
        purpose: 'research',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow(SoftCapExceeded)
    expect(create).not.toHaveBeenCalled()
  })

  it('still allows classification past the cap, because the system must keep working', async () => {
    await overSpend()
    await expect(
      complete({
        model: 'claude-haiku-4-5',
        purpose: 'classification',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).resolves.toBe('ok')
  })

  it('allows research while still under the cap', async () => {
    await setSetting('llm_soft_cap_cents', 1000)
    await db().query(
      `insert into core.llm_calls (model, purpose, cost_cents) values ('claude-sonnet-5', 'research', 150)`,
    )
    await expect(
      complete({
        model: 'claude-sonnet-5',
        purpose: 'research',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).resolves.toBe('ok')
  })
})

describe('monthToDateCents', () => {
  it('counts this month and ignores last month', async () => {
    await db().query(
      `insert into core.llm_calls (model, purpose, cost_cents, occurred_at) values
         ('claude-haiku-4-5', 'classification', 10, now()),
         ('claude-haiku-4-5', 'classification', 25, now()),
         ('claude-haiku-4-5', 'classification', 999, date_trunc('month', now()) - interval '1 day')`,
    )
    await expect(monthToDateCents()).resolves.toBeCloseTo(35)
  })

  it('is zero with no calls at all', async () => {
    await expect(monthToDateCents()).resolves.toBe(0)
  })
})
