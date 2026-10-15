import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { db } from './db'
import { registerTools, tokenMatches, toolName } from './mcp'

// The route itself is thin. What is worth testing is what gets registered and
// that a guarded call over MCP does not reach the table.

type Registered = {
  name: string
  config: { title?: string; description?: string; inputSchema?: z.ZodTypeAny }
  run: (input: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>
}

function collect(): { tools: Registered[]; server: Parameters<typeof registerTools>[0] } {
  const tools: Registered[] = []
  return {
    tools,
    server: {
      registerTool: (name, config, cb) => {
        tools.push({ name, config, run: cb as Registered['run'] })
      },
    },
  }
}

const find = (tools: Registered[], name: string) => tools.find((t) => t.name === name)
const payload = (result: { content: { text: string }[] }) => JSON.parse(result.content[0].text)

beforeEach(async () => {
  await db().query('delete from core.proposals')
  await db().query('delete from core.events')
  await db().query('delete from core.entities')
  await db().query('delete from ideas.idea')
  await db().query('delete from core.settings')
})

describe('registerTools', () => {
  it('registers every module tool namespaced, plus query and core.search', () => {
    const { tools, server } = collect()
    const names = registerTools(server)

    expect(names).toContain('ideas.get_digest')
    expect(names).toContain('ideas.write')
    // query is provided by core, so ideas never declared it.
    expect(names).toContain('ideas.query')
    expect(names).toContain('core.search')
    expect(tools).toHaveLength(names.length)
  })

  it('gives every tool a description, because that is what an agent chooses on', () => {
    const { tools, server } = collect()
    registerTools(server)
    for (const tool of tools) {
      expect(tool.config.description, tool.name).toBeTruthy()
    }
  })

  it('runs an unguarded tool for real', async () => {
    const { tools, server } = collect()
    registerTools(server)

    const result = await find(tools, 'ideas.write')!.run({ title: 'From MCP' })
    expect(result.isError).toBeFalsy()

    const { rows } = await db().query<{ title: string }>('select title from ideas.idea')
    expect(rows).toMatchObject([{ title: 'From MCP' }])
  })

  it('holds a guarded call as a proposal and says so, rather than writing', async () => {
    // observe guards everything, which is the cheapest way to exercise the path
    // without a module that guards.
    await db().query(
      `insert into core.settings (key, value) values ('agent_autonomy', '"observe"'::jsonb)`,
    )

    const { tools, server } = collect()
    registerTools(server)

    const result = await find(tools, 'ideas.write')!.run({ title: 'Held' })

    expect(payload(result)).toMatchObject({ proposed: true })
    const { rows } = await db().query('select 1 from ideas.idea')
    expect(rows).toHaveLength(0)
  })

  it('returns an error result rather than throwing, so the agent can read it', async () => {
    const { tools, server } = collect()
    registerTools(server)

    const result = await find(tools, 'ideas.query')!.run({ sql: 'delete from ideas.idea' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/delete/i)
  })

  it('exposes search over every module at once', async () => {
    const { tools, server } = collect()
    registerTools(server)

    const result = await find(tools, 'core.search')!.run({ query: 'nothing here' })
    expect(result.isError).toBeFalsy()
    expect(payload(result)).toHaveProperty('hits')
  })
})

describe('toolName', () => {
  it('namespaces by module', () => {
    expect(toolName('finance', 'get_digest')).toBe('finance.get_digest')
  })
})

describe('tokenMatches', () => {
  it('accepts the exact token', () => {
    expect(tokenMatches('s3cret', 's3cret')).toBe(true)
  })

  it('refuses a wrong, short, long, missing or unset token', () => {
    expect(tokenMatches('s3cres', 's3cret')).toBe(false)
    expect(tokenMatches('s3cre', 's3cret')).toBe(false)
    expect(tokenMatches('s3crett', 's3cret')).toBe(false)
    expect(tokenMatches(undefined, 's3cret')).toBe(false)
    // An unset MCP_TOKEN must lock the endpoint, not open it.
    expect(tokenMatches('anything', undefined)).toBe(false)
    expect(tokenMatches('', '')).toBe(false)
  })
})
