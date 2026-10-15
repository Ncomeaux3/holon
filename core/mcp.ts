import { z } from 'zod'
import { getModules } from './modules'
import { search } from './search'
import { callQuery, callTool } from './tools'

const QUERY_INPUT = z.object({ sql: z.string().min(1) })

// What an agent can reach. Every module tool, plus the two core provides, all
// of it going through callTool so the guard cannot be walked around: an agent
// has no other path to a module's tables.

/** Minimal shape of what registerTool needs, so this file does not import the SDK. */
type Registrar = {
  registerTool: (
    name: string,
    config: { title?: string; description?: string; inputSchema?: z.ZodTypeAny },
    // `unknown` rather than a precise shape: the SDK hands the callback `any`,
    // and `never` here would refuse it. Each callback casts what it needs.
    cb: (input: unknown) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>,
  ) => unknown
}

/**
 * Tool names are namespaced `<module>.<tool>`, which is what makes a name
 * readable in a client's tool list.
 */
export function toolName(moduleId: string, tool: string): string {
  return `${moduleId}.${tool}`
}

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
})

const failure = (error: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: error instanceof Error ? error.message : 'Tool failed',
    },
  ],
  isError: true,
})

/**
 * Registers everything an agent may call.
 *
 * A guarded tool is registered like any other: calling it writes a proposal
 * rather than the table, and the agent is told so. That is better than hiding
 * the tool, which would leave the agent unable to ask.
 */
export function registerTools(server: Registrar): string[] {
  const names: string[] = []

  const add: Registrar['registerTool'] = (name, config, cb) => {
    names.push(name)
    return server.registerTool(name, config, cb)
  }

  for (const manifest of getModules()) {
    for (const [tool, definition] of Object.entries(manifest.tools)) {
      const guarded = (manifest.guarded ?? []).includes(tool)

      add(
        toolName(manifest.id, tool),
        {
          title: `${manifest.nav.label}: ${tool}`,
          description: guarded
            ? `${definition.description} Guarded: this lands in the review inbox instead of writing.`
            : definition.description,
          inputSchema: definition.input,
        },
        async (input) => {
          try {
            const result = await callTool(manifest.id, tool, input, {
              source: 'agent',
              agent: 'mcp',
            })
            return result.status === 'proposed'
              ? text({
                  proposed: true,
                  proposalId: result.proposalId,
                  message: 'Held for review. Nothing was written.',
                })
              : text(result.result)
          } catch (error) {
            return failure(error)
          }
        },
      )
    }

    // Provided by core on every module, so a module author never writes one.
    add(
      toolName(manifest.id, 'query'),
      {
        title: `${manifest.nav.label}: query`,
        description: `Read-only SQL against the ${manifest.id} and core schemas. SELECT only, 5s timeout, 500 rows.`,
        inputSchema: QUERY_INPUT,
      },
      async (input) => {
        try {
          return text(await callQuery(manifest.id, QUERY_INPUT.parse(input).sql))
        } catch (error) {
          return failure(error)
        }
      },
    )
  }

  add(
    'core.search',
    {
      title: 'Search everything',
      description:
        'Hybrid search over every entity any module registered. Full text always, meaning when words find nothing.',
      inputSchema: z.object({
        query: z.string().min(1),
        module: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
    },
    async (input) => {
      try {
        const { query, module, limit } = input as { query: string; module?: string; limit?: number }
        return text(await search(query, { module, limit }))
      } catch (error) {
        return failure(error)
      }
    },
  )

  return names
}

/** Constant time compare, so the token cannot be guessed a character at a time. */
export function tokenMatches(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false

  let diff = 0
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

/**
 * The tool names without registering anything, for the Settings screen. Uses
 * the same code path as the endpoint, so the count on screen cannot drift from
 * what an agent actually sees.
 */
export function listToolNames(): string[] {
  return registerTools({ registerTool: () => undefined })
}

/** The tools with the description each one shows an agent, for the Settings screen. */
export function listTools(): { name: string; description: string }[] {
  const tools: { name: string; description: string }[] = []
  registerTools({
    registerTool: (name, config) => {
      tools.push({ name, description: config.description ?? '' })
    },
  })
  return tools
}

/** Which tools land in the review inbox when an agent calls them. */
export function guardedToolNames(): string[] {
  return getModules().flatMap((m) => (m.guarded ?? []).map((t) => toolName(m.id, t)))
}
