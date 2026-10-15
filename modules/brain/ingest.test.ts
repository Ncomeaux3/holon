import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

// The outbound layer and every address check it makes have their own suite in
// core/fetching.test.ts, including a real server proving the connection is pinned to
// the address that was checked. Here it is mocked, so these tests are about
// what ingestion does with a page once it has one.
const get = vi.fn()
vi.mock('@/core/fetching', async () => {
  const actual = await vi.importActual<typeof import('@/core/fetching')>('@/core/fetching')
  return { ...actual, get: (...args: unknown[]) => get(...args) }
})

const complete = vi.fn()
vi.mock('@/core/llm', async () => {
  const actual = await vi.importActual<typeof import('@/core/llm')>('@/core/llm')
  return { ...actual, complete: (...args: unknown[]) => complete(...args) }
})

const { db } = await import('@/core/db')
const { ingestUrl } = await import('./ingest')
// Through the registry rather than by importing ./manifest directly. The tool
// calls register(), which resolves the classifier through modules/_index, and
// importing this manifest first leaves that half initialised: the same cycle
// documented in core/entities.ts.
const { getModule } = await import('@/core/modules')
const manifest = getModule('brain')!

const ARTICLE = `<html><head><title>Replication | The Paper</title></head><body>
  <nav>Home Subscribe</nav>
  <article><p>${'Leaders and followers and the lag between them. '.repeat(30)}</p></article>
</body></html>`

const page = (body: string, over = {}) => ({
  status: 200,
  location: null,
  contentType: 'text/html; charset=utf-8',
  body,
  truncated: false,
  ...over,
})

beforeEach(() => {
  complete.mockReset()
  complete.mockResolvedValue('A summary of the piece.')
  get.mockReset()
  get.mockResolvedValue(page(ARTICLE))
})
afterEach(async () => {
  await db().query('delete from brain.link')
  await db().query('delete from brain.note')
  await db().query('delete from core.events')
  await db().query('delete from core.entities')
})
afterAll(async () => {
  await db().end()
})

describe('ingestUrl', () => {
  it('extracts, summarises, and keeps the source beside the summary', async () => {
    const found = await ingestUrl('https://example.com/a')

    expect(found.title).toBe('Replication')
    expect(found.summary).toBe('A summary of the piece.')
    expect(found.sourceText).toContain('Leaders and followers')
    expect(found.sourceText).not.toContain('Subscribe')
    expect(found.kind).toBe('article')
  })

  // Checked before anything leaves, so a refusal costs no request at all.
  it('refuses a private address without fetching', async () => {
    await expect(ingestUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/private/)
    expect(get).not.toHaveBeenCalled()
  })

  // The worst thing this feature could do is write a confident note about an
  // article nobody could read.
  it('refuses a paywall stub rather than summarising it', async () => {
    get.mockResolvedValue(page('<body><p>Subscribe to continue.</p></body>'))

    await expect(ingestUrl('https://example.com/a')).rejects.toThrow(/almost no text/)
    expect(complete).not.toHaveBeenCalled()
  })

  it('refuses something that is not a page', async () => {
    get.mockResolvedValue(page('%PDF', { contentType: 'application/pdf' }))

    await expect(ingestUrl('https://example.com/a.pdf')).rejects.toThrow(/not a page/)
  })

  it('says what a failing page answered', async () => {
    get.mockResolvedValue(page('no', { status: 404 }))

    await expect(ingestUrl('https://example.com/a')).rejects.toThrow(/404/)
  })

  // A summary is optional. The draft still arrives with the full source on it,
  // and the owner can write the note themselves, which is the point.
  it('still returns the source when the model is past the cap', async () => {
    const { SoftCapExceeded } = await import('@/core/llm')
    complete.mockRejectedValue(new SoftCapExceeded(1000, 1000))

    const found = await ingestUrl('https://example.com/a')

    expect(found.summary).toBe('')
    expect(found.sourceText).toContain('Leaders and followers')
    expect(found.note).toContain('cap')
  })

  it('says so when Anthropic is not connected, rather than failing the ingest', async () => {
    const { NotConnected } = await import('@/core/llm')
    complete.mockRejectedValue(new NotConnected('nope'))

    const found = await ingestUrl('https://example.com/a')

    expect(found.summary).toBe('')
    expect(found.note).toContain('not connected')
  })
})

describe('the ingest tool', () => {
  const run = (url: string) => manifest.tools.ingest.run({ url }, { source: 'ui' })

  it('is guarded, because it spends money; delete is, because it removes', () => {
    expect(manifest.guarded).toEqual(['ingest', 'delete'])
  })

  // Every other write tool publishes for the owner and drafts for an agent.
  // This one drafts for everyone: the body is something a model wrote.
  it('always produces a draft, even for the owner', async () => {
    await run('https://example.com/a')

    const { rows } = await db().query<{ status: string; source_url: string; body: string }>(
      `select status, source_url, body from brain.note`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('draft')
    expect(rows[0].source_url).toBe('https://example.com/a')
    expect(rows[0].body).toBe('A summary of the piece.')
  })

  it('emits note_ingested rather than a creation, so a draft earns nothing', async () => {
    await run('https://example.com/a')

    const { rows } = await db().query<{ event_type: string }>(
      `select event_type from core.events where module = 'brain'`,
    )
    expect(rows.map((r) => r.event_type)).toEqual(['note_ingested'])
  })
})
