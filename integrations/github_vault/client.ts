import { getCredentials } from '@/core/credentials'

// The Obsidian vault, read over the GitHub contents API.
//
// Read only, deliberately. SPEC says the app never edits the vault without a
// review step, and the cheapest way to guarantee that is for this file to have
// no way to write. A commit, when Second Brain proposes one, goes through
// core.proposals and a separate call that does not live here.
//
// The contents API rather than cloning: Vercel's filesystem is read only at
// runtime, so there is nowhere to put a working copy.

const API = 'https://api.github.com'

export class VaultError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'VaultError'
  }
}

type Creds = { repo: string; token: string }

async function creds(override?: Partial<Creds>): Promise<Creds> {
  const stored = await getCredentials('github_vault')
  const repo = override?.repo ?? stored?.repo
  const token = override?.token ?? stored?.token
  if (!repo || !token) {
    throw new VaultError(0, 'The vault is not connected. Connect it on Settings > Connections.')
  }
  return { repo: normaliseRepo(repo), token }
}

/**
 * "owner/name" out of whatever was pasted into the field.
 *
 * A pasted browser URL or a clone URL is the obvious way to get this wrong,
 * and the failure it causes is a 404 that reads as "no access" rather than
 * "you pasted a URL", so accept all three forms instead.
 */
export function normaliseRepo(input: string): string {
  return input
    .trim()
    .replace(/^git@github\.com:/, '')
    .replace(/^https?:\/\/(www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/^\/+|\/+$/g, '')
}

async function get<T>(path: string, override?: Partial<Creds>): Promise<T> {
  const { repo, token } = await creds(override)
  const res = await fetch(`${API}/repos/${repo}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    // A private repo the token cannot see returns 404, not 403, so the two
    // cases cannot be told apart and the message must not claim either.
    const detail =
      res.status === 404
        ? 'not found, or the token cannot see it'
        : (await res.text()).slice(0, 200)
    throw new VaultError(res.status, `GitHub ${res.status}: ${detail}`)
  }
  return (await res.json()) as T
}

export type Repo = { full_name: string; private: boolean; default_branch: string }

export function repo(override?: Partial<Creds>): Promise<Repo> {
  return get<Repo>('', override)
}

export type VaultNote = {
  /** Path inside the repo, which is the note's identity. */
  path: string
  /** Git blob sha. Changes when and only when the content does. */
  sha: string
  size: number
}

type TreeEntry = { path: string; type: string; sha: string; size?: number }

/**
 * Every markdown file in the vault, in one call.
 *
 * The recursive tree endpoint rather than walking directories: a vault is
 * thousands of files in nested folders, and walking it is one request per
 * folder against a 5,000 an hour limit.
 *
 * `truncated` is GitHub telling us the tree was too big to return whole. It is
 * surfaced rather than swallowed, because a silently partial vault would look
 * exactly like a vault with fewer notes in it.
 */
export async function notes(
  branch?: string,
  override?: Partial<Creds>,
): Promise<{ notes: VaultNote[]; truncated: boolean }> {
  const ref = branch ?? (await repo(override)).default_branch
  const tree = await get<{ tree: TreeEntry[]; truncated: boolean }>(
    `/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    override,
  )

  return {
    notes: tree.tree
      .filter((e) => e.type === 'blob' && e.path.toLowerCase().endsWith('.md'))
      .map((e) => ({ path: e.path, sha: e.sha, size: e.size ?? 0 })),
    truncated: tree.truncated,
  }
}

/**
 * One note's text, by blob sha rather than by path.
 *
 * The sha is what `notes()` already returned, and it is immutable, so this
 * cannot race a push that moves the file. The blob endpoint also has no path
 * to escape: there is no traversal to guard against because there is no path.
 */
export async function read(sha: string, override?: Partial<Creds>): Promise<string> {
  const blob = await get<{ content: string; encoding: string }>(`/git/blobs/${sha}`, override)
  if (blob.encoding !== 'base64') {
    throw new VaultError(0, `Unexpected blob encoding ${blob.encoding}`)
  }
  return Buffer.from(blob.content, 'base64').toString('utf8')
}
