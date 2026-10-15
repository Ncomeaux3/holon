import Anthropic from '@anthropic-ai/sdk'
import { db } from './db'
import { getCredentials } from './integrations'
import { getSetting } from './settings'

/**
 * Cents per million tokens. Verified 2026-06-24 against Anthropic's pricing
 * table. Re-check this date before trusting the month to date figure, and
 * whenever a model is added.
 */
const PRICES = {
  'claude-haiku-4-5': { input: 100, output: 500 },
  'claude-sonnet-5': { input: 200, output: 1000 },
  'claude-opus-5': { input: 500, output: 2500 },
} as const

export type Model = keyof typeof PRICES

/**
 * Haiku classifies, Sonnet researches. The split is what keeps the whole
 * system inside a $10 a month cap.
 *
 * There was a third purpose, 'headline', for the sentence on the dashboard.
 * That is a template now: see writeHeadline in core/orchestrator.ts.
 */
export type Purpose = 'classification' | 'summary' | 'research' | 'mail' | 'recipe'

/**
 * Purposes the soft cap can stop.
 *
 * Classification is not one: it keeps the system working and costs a fraction
 * of a cent. Research and summarising are both owner-initiated and both
 * degrade rather than break, a draft still arrives with the source text on it,
 * so they stop when the month's budget is gone. Mail (Phase 7c) stops too:
 * over the cap the Gmail job still proposes from the subject alone. Recipe
 * (v1.2 Phase 12) stops too: over the cap a pasted recipe is still a draft,
 * read by the rules alone.
 */
const CAPPED_PURPOSES: Purpose[] = ['research', 'summary', 'mail', 'recipe']

/** Distinct from a call that failed: the provider was never connected. */
export class NotConnected extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotConnected'
  }
}

export class SoftCapExceeded extends Error {
  constructor(spentCents: number, capCents: number) {
    super(
      `Model spend this month is ${(spentCents / 100).toFixed(2)} against a cap of ${(capCents / 100).toFixed(2)}. Raise llm_soft_cap_cents in Settings to continue research.`,
    )
    this.name = 'SoftCapExceeded'
  }
}

/**
 * Cents per server-side web search.
 *
 * $10 per 1,000 searches, verified 2026-09-09 against
 * platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool. Billed
 * on top of tokens. A search that errors is not billed, and the count this uses
 * comes from the response rather than from what we asked for, so an error does
 * not appear on the bill here either.
 */
const CENTS_PER_SEARCH = 1

export function estimateCostCents(
  model: Model,
  inputTokens: number,
  outputTokens: number,
  webSearches = 0,
): number {
  const price = PRICES[model]
  // Logging a zero cost for an unknown model would quietly break the cap.
  if (!price) throw new Error(`No price entry for model ${model}. Add it to PRICES in core/llm.ts.`)
  return (
    (inputTokens * price.input + outputTokens * price.output) / 1_000_000 +
    webSearches * CENTS_PER_SEARCH
  )
}

export async function monthToDateCents(): Promise<number> {
  const { rows } = await db().query<{ total: string | null }>(
    `select sum(cost_cents) as total from core.llm_calls
     where occurred_at >= date_trunc('month', now())`,
  )
  return Number(rows[0]?.total ?? 0)
}

type CompleteArgs = {
  model: Model
  purpose: Purpose
  module?: string
  system?: string
  messages: Anthropic.MessageParam[]
  maxTokens?: number
}

/**
 * The only way anything in this system calls a model. Every call lands in
 * core.llm_calls so month to date spend is a query rather than a guess.
 */
export async function complete({
  model,
  purpose,
  module,
  system,
  messages,
  maxTokens = 4096,
}: CompleteArgs): Promise<string> {
  return (await run({ model, purpose, module, system, messages, maxTokens })).text
}

/** One cited source, exactly as the search returned it. */
export type Source = { url: string; title: string; citedText: string }

export type SearchedCompletion = {
  text: string
  /** Every source cited in the reply, deduplicated by URL. */
  sources: Source[]
  /** Searches the API says it ran, which is what it billed for. */
  searches: number
  costCents: number
}

/**
 * A completion that may search the web, with its sources and its bill.
 *
 * Separate from complete() because the caller has to see the sources: a claim
 * whose URL is not in this list is one the module refuses to store. The basic
 * search tool rather than the filtering one, because the filtering variant runs
 * through code execution and this module has no use for a second execution
 * environment.
 */
export async function completeWithSearch(
  args: CompleteArgs & { maxSearches: number; allowedDomains?: string[] },
): Promise<SearchedCompletion> {
  return run(args)
}

async function run(
  args: CompleteArgs & { maxSearches?: number; allowedDomains?: string[] },
): Promise<SearchedCompletion> {
  const { model, purpose, module, system, messages, maxTokens = 4096 } = args

  if (CAPPED_PURPOSES.includes(purpose)) {
    const [spent, cap] = await Promise.all([monthToDateCents(), getSetting('llm_soft_cap_cents')])
    if (spent >= cap) throw new SoftCapExceeded(spent, cap)
  }

  const client = new Anthropic({ apiKey: await apiKey() })
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages,
    ...(args.maxSearches
      ? {
          tools: [
            {
              // Verified 2026-09-09: the basic variant, supported on every
              // model here. max_uses is a hard cap, and exceeding it returns an
              // error block rather than more searches.
              type: 'web_search_20250305',
              name: 'web_search',
              max_uses: args.maxSearches,
              ...(args.allowedDomains ? { allowed_domains: args.allowedDomains } : {}),
            },
          ] as Anthropic.ToolUnion[],
        }
      : {}),
  })

  const inputTokens = response.usage?.input_tokens ?? 0
  const outputTokens = response.usage?.output_tokens ?? 0
  // What the API says it ran. Asking for five and being billed for two is the
  // normal case, and a search that errored is not counted here or billed.
  const searches = response.usage?.server_tool_use?.web_search_requests ?? 0
  const costCents = estimateCostCents(model, inputTokens, outputTokens, searches)

  await db().query(
    `insert into core.llm_calls
       (model, purpose, module, input_tokens, output_tokens, cost_cents, web_searches)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [model, purpose, module ?? null, inputTokens, outputTokens, costCents, searches],
  )

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')

  return { text, sources: sourcesOf(response), searches, costCents }
}

/**
 * Every page the search actually returned, plus what was quoted from it.
 *
 * Both halves matter and neither is enough alone. Citations only attach to
 * prose, so a reply asked for as JSON carries none at all, and reading only
 * citations would mean a structured report could never cite anything. Search
 * results alone carry no quote, so the citation text is merged in where the
 * model did quote a page.
 *
 * What this list is for: deciding whether a URL in a claim is one the model
 * actually read, or one it produced from memory. A page that came back from a
 * search is the first; nothing else is.
 */
function sourcesOf(response: Anthropic.Message): Source[] {
  const byUrl = new Map<string, Source>()

  for (const block of response.content) {
    if (block.type === 'web_search_tool_result') {
      // On an error the content is a single error object rather than a list of
      // results, which is documented and is not an exception.
      const results = Array.isArray(block.content) ? block.content : []
      for (const result of results) {
        if (result.type !== 'web_search_result') continue
        if (!byUrl.has(result.url)) {
          byUrl.set(result.url, { url: result.url, title: result.title, citedText: '' })
        }
      }
    }

    if (block.type === 'text' && block.citations) {
      for (const citation of block.citations) {
        if (citation.type !== 'web_search_result_location') continue
        const existing = byUrl.get(citation.url)
        byUrl.set(citation.url, {
          url: citation.url,
          title: citation.title ?? existing?.title ?? citation.url,
          citedText: citation.cited_text ?? existing?.citedText ?? '',
        })
      }
    }
  }

  return [...byUrl.values()]
}

/**
 * The key lives encrypted in core.connections, entered on Settings >
 * Connections. Nothing reads a provider key from .env.
 */
async function apiKey(): Promise<string> {
  const key = (await getCredentials('anthropic'))?.api_key
  if (!key) {
    throw new NotConnected('Anthropic is not connected. Connect it on Settings > Connections.')
  }
  return key
}
