// The research rubric: what is asked, and what is allowed to survive the
// answer. No imports: the Ideas screen is a client component and anything
// reaching core/db.ts drags pg into the browser bundle.
//
// SPEC section 2: "Every number in a report needs a cited source or it is not
// written." That is enforced here rather than asked for politely in a prompt.
// A model told to cite everything will still occasionally produce a confident
// number with no URL behind it, and the whole point of a research report is
// that you can check it.

export type Claim = {
  text: string
  /** The URL the claim came from. Empty means the model gave none. */
  source: string
}

export type Section = {
  key: SectionKey
  label: string
  /** Prose with no numbers in it. Kept whether or not anything was cited. */
  summary: string
  claims: Claim[]
}

export type SectionKey =
  | 'problem'
  | 'market'
  | 'competitors'
  | 'differentiation'
  | 'feasibility'

export const SECTIONS: { key: SectionKey; label: string; ask: string }[] = [
  { key: 'problem', label: 'Problem', ask: 'Who has this problem and what do they do about it today?' },
  { key: 'market', label: 'Market', ask: 'How many of them are there and what do they already pay? Numbers only where you can cite one.' },
  { key: 'competitors', label: 'Competitors', ask: 'Who already does this, and what does it cost?' },
  { key: 'differentiation', label: 'Differentiation', ask: 'What would this do that those do not?' },
  { key: 'feasibility', label: 'Feasibility for a solo builder', ask: 'What would one person nights and weekends have to build, buy or learn?' },
]

/** Digits that are not a year. A year is context; a number is a claim. */
const HAS_NUMBER = /\d/
const YEAR_ONLY = /^\D*(19|20)\d{2}\D*$/

/**
 * Whether a sentence makes a numeric claim.
 *
 * A bare year does not: "founded in 2019" is context, and demanding a citation
 * for it would strip half the prose for nothing. Everything else with a digit
 * in it is a number somebody could be wrong about.
 */
export function isNumeric(text: string): boolean {
  return HAS_NUMBER.test(text) && !YEAR_ONLY.test(text)
}

/**
 * Drop every claim the report is not entitled to make.
 *
 * A numeric claim survives only if its source URL is one the search actually
 * returned. Two failures it catches: a number with no URL at all, and a URL the
 * model produced from memory, which looks exactly like a citation and is not
 * one.
 *
 * A claim with no number and no source is kept: opinion is allowed, it just
 * cannot wear numbers it did not earn.
 */
export function keepSourced(claims: Claim[], allowedUrls: string[]): Claim[] {
  const allowed = new Set(allowedUrls.map(normalise))
  return claims.filter((claim) => {
    if (!isNumeric(claim.text)) return true
    return claim.source !== '' && allowed.has(normalise(claim.source))
  })
}

/** Trailing slashes and query strings are not what makes a source different. */
function normalise(url: string): string {
  return url.trim().replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase()
}

export type Verdict = 'build' | 'park' | 'drop' | 'unclear'

/**
 * The verdict, and how sure the report says it is.
 *
 * `unclear` is a real answer and the default. A rubric that always reaches
 * build, park or drop is one that is guessing on the runs where the evidence
 * was thin, and thin evidence is the common case for an idea somebody wrote
 * down on a walk.
 */
export function parseReport(reply: string, allowedUrls: string[]): {
  verdict: Verdict
  confidence: number | null
  sections: Section[]
} {
  const parsed = parseJson(reply)

  const verdict = (['build', 'park', 'drop'] as const).find((v) => v === parsed?.verdict) ?? 'unclear'
  const rawConfidence = typeof parsed?.confidence === 'number' ? parsed.confidence : null
  const confidence =
    rawConfidence === null ? null : Math.min(Math.max(rawConfidence, 0), 1)

  const sections = SECTIONS.map((spec) => {
    const found = Array.isArray(parsed?.sections)
      ? parsed.sections.find((s: { key?: string }) => s?.key === spec.key)
      : undefined

    const claims: Claim[] = Array.isArray(found?.claims)
      ? found.claims
          .filter((c: { text?: unknown }) => typeof c?.text === 'string' && c.text.trim() !== '')
          .map((c: { text: string; source?: unknown }) => ({
            text: c.text.trim(),
            source: typeof c.source === 'string' ? c.source.trim() : '',
          }))
      : []

    return {
      key: spec.key,
      label: spec.label,
      // Prose is kept as written, but a numeric sentence in it is a claim
      // wearing no citation, so the summary is held to the same rule.
      summary: isNumeric(String(found?.summary ?? '')) ? '' : String(found?.summary ?? '').trim(),
      claims: keepSourced(claims, allowedUrls),
    }
  })

  return { verdict, confidence, sections }
}

function parseJson(reply: string): {
  verdict?: string
  confidence?: number
  sections?: { key?: string; summary?: string; claims?: { text: string; source?: string }[] }[]
} | null {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(reply.slice(start, end + 1))
  } catch {
    return null
  }
}

/** How many searches a run is allowed. Quick is the default per decision. */
export function searchBudget(depth: 'quick' | 'deep'): number {
  return depth === 'deep' ? 12 : 4
}

export const SYSTEM = `You research a product idea for one person building it nights and weekends.

Search the web for anything current: market size, what competitors charge, whether a thing exists already. Do not search for things you already know.

Rules that matter more than being helpful:
- Every number you write must come from a page you actually searched, and you must put that page's URL in the claim's source field. A number with no source is deleted before the owner sees it, so writing one wastes both our time.
- If you could not find a number, say what you could not find. That is a useful answer.
- No encouragement. The owner has more ideas than evenings, and the job is to help them drop things.

Reply with JSON only, no prose around it:
{"verdict":"build"|"park"|"drop","confidence":0.0-1.0,"sections":[{"key":"problem"|"market"|"competitors"|"differentiation"|"feasibility","summary":"prose, no numbers","claims":[{"text":"one sentence","source":"https://..."}]}]}`
