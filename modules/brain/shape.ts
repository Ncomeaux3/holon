// Pure helpers for the Second Brain screen. No imports: the screen is a client
// component and anything reaching core/db.ts drags pg into the browser bundle.

const DAY = 86_400_000

/** "today", "1d", "9d": days since the note last changed. */
export function ago(updatedAt: string, now = Date.now()): string {
  const days = Math.max(0, Math.floor((now - Date.parse(updatedAt)) / DAY))
  return days === 0 ? 'today' : `${days}d`
}

export function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

/**
 * The row's second line: where the note came from, then its length. The
 * artboard's reading times and authors have no source in the app.
 */
export function subLine(note: {
  kind: string
  sourceUrl: string
  source: string
  externalId: string | null
  body: string
}): string {
  let head = note.kind
  if (note.sourceUrl) {
    try {
      head = new URL(note.sourceUrl).hostname.replace(/^www\./, '')
    } catch {
      head = note.kind
    }
  } else if (note.source === 'vault' && note.externalId?.includes('/')) {
    head = note.externalId.slice(0, note.externalId.lastIndexOf('/'))
  }
  const n = wordCount(note.body)
  return `${head} · ${n} ${n === 1 ? 'word' : 'words'}`
}

/** "RULES · 2 · MODEL · 1": how the skill links were classified. */
export function byLine(links: { by: 'rule' | 'model' | 'manual' }[]): string {
  const count = (by: string) => links.filter((l) => l.by === by).length
  return ([
    ['RULES', count('rule')],
    ['MODEL', count('model')],
    ['MANUAL', count('manual')],
  ] as const)
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${label} · ${n}`)
    .join(' · ')
}

/** The Source card's meta: "URL · 1,840 words", "YouTube · 300 words", "Manual · book". */
export function sourceMeta(note: { sourceUrl: string; sourceText: string; kind: string }): string {
  if (!note.sourceUrl) return `Manual · ${note.kind}`
  const from = /youtu\.?be/.test(note.sourceUrl) ? 'YouTube' : 'URL'
  return `${from} · ${wordCount(note.sourceText).toLocaleString('en-US')} words`
}

export const KINDS = ['article', 'book', 'video', 'note', 'project', 'person', 'daily'] as const
export type Kind = (typeof KINDS)[number]

/** The folder chip's label: the artboard's lowercase plurals. */
export function folderLabel(kind: string): string {
  if (kind === 'daily') return 'daily'
  if (kind === 'person') return 'people'
  return `${kind}s`
}

/** "Aug 12": the date a book or article was accepted, which is when it was finished. */
export function finishedOn(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
