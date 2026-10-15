import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const fileByRules = vi.fn()
vi.mock('./hubs', async () => {
  const actual = await vi.importActual<typeof import('./hubs')>('./hubs')
  return { ...actual, fileByRules: (...args: unknown[]) => fileByRules(...args) }
})

const embedChanged = vi.fn()
vi.mock('@/core/search', async () => {
  const actual = await vi.importActual<typeof import('@/core/search')>('@/core/search')
  return { ...actual, embedChanged: (...args: unknown[]) => embedChanged(...args) }
})

const upload = vi.fn()
const download = vi.fn()
vi.mock('@/core/files', () => ({
  upload: (...args: unknown[]) => upload(...args),
  download: (...args: unknown[]) => download(...args),
}))

const complete = vi.fn()
vi.mock('@/core/llm', async () => {
  const actual = await vi.importActual<typeof import('@/core/llm')>('@/core/llm')
  return { ...actual, complete: (...args: unknown[]) => complete(...args) }
})

const { db } = await import('@/core/db')
const { SoftCapExceeded } = await import('@/core/llm')
const { captureFile, captureText, PENDING, transcribePending } = await import('./capture')

async function saved(id: string) {
  const { rows } = await db().query<{ title: string; body: string; kind: string; status: string; source: string }>(
    `select title, body, kind, status, source from brain.note where id = $1`,
    [id],
  )
  return rows[0]
}

beforeEach(() => {
  fileByRules.mockReset()
  embedChanged.mockReset()
  embedChanged.mockResolvedValue({ scanned: 0, indexed: 0, embedded: 0 })
  upload.mockReset()
  upload.mockImplementation(async (module: string, path: string) => ({ module, path }))
  download.mockReset()
  complete.mockReset()
  complete.mockResolvedValue('the words on the page')
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

describe('captureText', () => {
  it('splits the first line into the title and the rest into the body', async () => {
    const { id } = await captureText({ text: '  Postgres planner  \nhow it picks a join\nand why', worked: false })

    expect(await saved(id)).toEqual({
      title: 'Postgres planner',
      body: 'how it picks a join\nand why',
      kind: 'note',
      status: 'published',
      source: 'manual',
    })
  })

  it('keeps one line of text as both title and body', async () => {
    const { id } = await captureText({ text: 'Read DDIA chapter 5', worked: false })

    const row = await saved(id)
    expect(row.title).toBe('Read DDIA chapter 5')
    expect(row.body).toBe('Read DDIA chapter 5')
  })

  it('caps the title at 120 characters', async () => {
    const { id } = await captureText({ text: 'x'.repeat(200), worked: false })
    expect((await saved(id)).title).toHaveLength(120)
  })

  it('files a worked on entry as daily', async () => {
    const { id } = await captureText({ text: 'Shipped the hubs migration', worked: true })
    expect((await saved(id)).kind).toBe('daily')
  })

  it('files by rules and embeds so the note is related-able now', async () => {
    const { id } = await captureText({ text: 'Postgres planner\nbody', worked: false })

    expect(fileByRules).toHaveBeenCalledWith(id, 'Postgres planner', 'body')
    expect(embedChanged).toHaveBeenCalledTimes(1)
  })

  it('drafts for an agent', async () => {
    const { id, status } = await captureText({ text: 'From an agent', worked: false }, 'agent')
    expect(status).toBe('draft')
    expect((await saved(id)).source).toBe('agent')
  })
})

async function savedFile(id: string) {
  const { rows } = await db().query<{ title: string; body: string; kind: string; status: string; file_path: string }>(
    `select title, body, kind, status, file_path from brain.note where id = $1`,
    [id],
  )
  return rows[0]
}

describe('captureFile', () => {
  const pdf = { name: 'Notes 2026.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF-1.4 fake') }
  const png = { name: 'board.png', type: 'image/png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }

  it('stores a PDF under the note id and transcribes it with a document block', async () => {
    const { id } = await captureFile(pdf)

    expect(upload).toHaveBeenCalledWith('brain', `${id}/Notes_2026.pdf`, pdf.bytes, 'application/pdf')
    expect(complete).toHaveBeenCalledTimes(1)
    const call = complete.mock.calls[0][0] as { model: string; purpose: string; module: string; messages: { content: { type: string; source: { media_type: string; data: string } }[] }[] }
    expect(call.model).toBe('claude-haiku-4-5')
    expect(call.purpose).toBe('summary')
    expect(call.module).toBe('brain')
    expect(call.messages[0].content[0]).toMatchObject({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: pdf.bytes.toString('base64') },
    })
    expect(await savedFile(id)).toEqual({
      title: 'Notes 2026.pdf',
      body: 'the words on the page',
      kind: 'note',
      status: 'published',
      file_path: `${id}/Notes_2026.pdf`,
    })
    expect(fileByRules).toHaveBeenCalledWith(id, 'Notes 2026.pdf', 'the words on the page')
    expect(embedChanged).toHaveBeenCalledTimes(1)
  })

  it('sends an image as an image block', async () => {
    await captureFile(png)

    const call = complete.mock.calls[0][0] as { messages: { content: { type: string; source: { media_type: string } }[] }[] }
    expect(call.messages[0].content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png' } })
  })

  it('rejects other types and files over 10 MB before uploading', async () => {
    await expect(captureFile({ name: 'a.docx', type: 'application/msword', bytes: Buffer.alloc(1) })).rejects.toThrow(/PDF|image/)
    await expect(captureFile({ ...png, bytes: Buffer.alloc(10 * 1024 * 1024 + 1) })).rejects.toThrow(/10 MB/)
    expect(upload).not.toHaveBeenCalled()
    const { rows } = await db().query('select 1 from brain.note')
    expect(rows).toHaveLength(0)
  })

  it('leaves the body as the pending line when the cap stops the call', async () => {
    complete.mockRejectedValue(new SoftCapExceeded(1000, 1000))
    const { id } = await captureFile(pdf)

    expect((await savedFile(id)).body).toBe(PENDING)
    expect((await savedFile(id)).file_path).toBe(`${id}/Notes_2026.pdf`)
  })

  it('retries one pending file a night from the stored bytes', async () => {
    complete.mockRejectedValueOnce(new SoftCapExceeded(1000, 1000))
    const { id } = await captureFile(pdf)
    download.mockResolvedValue(new Blob([pdf.bytes], { type: 'application/pdf' }))

    expect(await transcribePending()).toEqual({ transcribed: 1 })
    expect(download).toHaveBeenCalledWith({ module: 'brain', path: `${id}/Notes_2026.pdf` })
    expect((await savedFile(id)).body).toBe('the words on the page')
    expect(await transcribePending()).toEqual({ transcribed: 0 })
  })
})
