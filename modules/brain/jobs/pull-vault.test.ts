import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

const getCredentials = vi.fn()
const notes = vi.fn()
const read = vi.fn()

vi.mock('@/core/credentials', () => ({ getCredentials: () => getCredentials() }))
vi.mock('@/integrations/github_vault/client', async () => {
  const actual = await vi.importActual<typeof import('@/integrations/github_vault/client')>(
    '@/integrations/github_vault/client',
  )
  return {
    ...actual,
    notes: () => notes(),
    read: (sha: string) => read(sha),
  }
})

const { db } = await import('@/core/db')
const { pullVault, kindOf, slugOf, stripFrontmatter, titleOf } = await import('./pull-vault')

beforeEach(() => {
  getCredentials.mockReset()
  notes.mockReset()
  read.mockReset()
  getCredentials.mockResolvedValue({ repo: 'nick/vault', token: 'x' })
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

const file = (path: string, sha: string) => ({ path, sha, size: 10 })

async function storedNotes() {
  const { rows } = await db().query<{
    title: string
    slug: string
    kind: string
    status: string
    body: string
    vault_sha: string
    external_id: string
  }>(
    `select title, slug, kind, status, body, vault_sha, external_id
       from brain.note order by external_id`,
  )
  return rows
}

describe('pullVault', () => {
  it('does nothing at all when the vault is not connected', async () => {
    getCredentials.mockResolvedValue(null)

    const result = await pullVault()

    expect(result.skipped).toBe(true)
    expect(notes).not.toHaveBeenCalled()
  })

  it('reads a file and stores it as a published note', async () => {
    notes.mockResolvedValue({ notes: [file('Books/DDIA.md', 'sha1')], truncated: false })
    read.mockResolvedValue('# Replication\n\nQuorums and leaders.')

    const result = await pullVault()

    expect(result.written).toBe(1)
    const [note] = await storedNotes()
    // Published, not draft. A file already in the vault is the owner's note;
    // the draft state is for what the app proposes to add.
    expect(note.status).toBe('published')
    expect(note.kind).toBe('book')
    expect(note.slug).toBe('ddia')
    expect(note.external_id).toBe('Books/DDIA.md')
  })

  // The whole reason the pull is cheap. An unchanged blob sha means an
  // unchanged file, so there is no read and no write.
  it('does not read a file whose sha has not moved', async () => {
    notes.mockResolvedValue({ notes: [file('Note.md', 'sha1')], truncated: false })
    read.mockResolvedValue('first')
    await pullVault()

    read.mockClear()
    const second = await pullVault()

    expect(read).not.toHaveBeenCalled()
    expect(second.changed).toBe(0)
    expect(second.written).toBe(0)
  })

  it('rewrites a note when the file behind it changed', async () => {
    notes.mockResolvedValue({ notes: [file('Note.md', 'sha1')], truncated: false })
    read.mockResolvedValue('first')
    await pullVault()

    notes.mockResolvedValue({ notes: [file('Note.md', 'sha2')], truncated: false })
    read.mockResolvedValue('second')
    await pullVault()

    const rows = await storedNotes()
    expect(rows).toHaveLength(1)
    expect(rows[0].body).toBe('second')
    expect(rows[0].vault_sha).toBe('sha2')
  })

  // A backfill is not a night's work. Emitting per note would award every note
  // written over five years today's XP and spike the Skill Tree.
  it('registers notes for search without emitting events', async () => {
    notes.mockResolvedValue({ notes: [file('A.md', 's1'), file('B.md', 's2')], truncated: false })
    read.mockResolvedValue('body')

    await pullVault()

    const { rows: entities } = await db().query(`select id from core.entities where module = 'brain'`)
    const { rows: events } = await db().query(`select id from core.events where module = 'brain'`)
    expect(entities).toHaveLength(2)
    expect(events).toHaveLength(0)
  })

  it('links notes to each other through wikilinks', async () => {
    notes.mockResolvedValue({
      notes: [file('A.md', 's1'), file('DDIA.md', 's2')],
      truncated: false,
    })
    read.mockImplementation(async (sha: string) =>
      sha === 's1' ? 'See [[DDIA]] for more.' : 'The book.',
    )

    await pullVault()

    const { rows } = await db().query<{ to_slug: string; resolved: boolean }>(
      `select to_slug, (to_note_id is not null) as resolved from brain.link`,
    )
    expect(rows).toEqual([{ to_slug: 'ddia', resolved: true }])
  })

  // A file that has gone is not a note that should go. The vault is a git repo
  // and the app is not the last copy, but a rename should not delete anything.
  it('counts a note whose file has gone without deleting it', async () => {
    notes.mockResolvedValue({ notes: [file('A.md', 's1')], truncated: false })
    read.mockResolvedValue('body')
    await pullVault()

    notes.mockResolvedValue({ notes: [], truncated: false })
    const result = await pullVault()

    expect(result.orphaned).toBe(1)
    expect(await storedNotes()).toHaveLength(1)
  })

  it('says so when the vault tree came back truncated', async () => {
    notes.mockResolvedValue({ notes: [file('A.md', 's1')], truncated: true })
    read.mockResolvedValue('body')

    const result = await pullVault()

    expect(result.detail).toContain('truncated')
  })
})

describe('the file to note mapping', () => {
  it('takes the title from the file name, as Obsidian does', () => {
    expect(titleOf('Books/DDIA.md', '# Something else\n')).toBe('DDIA')
  })

  it('links by file name rather than path, as Obsidian does', () => {
    // [[DDIA]] in the vault has to reach Books/Distributed/DDIA.md.
    expect(slugOf('Books/Distributed/DDIA.md')).toBe('ddia')
    expect(slugOf('DDIA.md')).toBe('ddia')
  })

  it('reads the kind off the folder and defaults to note', () => {
    expect(kindOf('Books/x.md')).toBe('book')
    expect(kindOf('Clippings/x.md')).toBe('article')
    expect(kindOf('Daily/2026-09-09.md')).toBe('daily')
    expect(kindOf('Some/Other/Place/x.md')).toBe('note')
    expect(kindOf('x.md')).toBe('note')
  })

  it('strips frontmatter but leaves a horizontal rule alone', () => {
    expect(stripFrontmatter('---\ntags: [a]\n---\nBody')).toBe('Body')
    // Three dashes further down are a rule, not metadata.
    expect(stripFrontmatter('Body\n\n---\n\nMore')).toBe('Body\n\n---\n\nMore')
  })
})
