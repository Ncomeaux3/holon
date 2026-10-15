// Open-Meteo geocoding, no key (docs/research/open-meteo-geocoding.md). Suggestions
// only: a form must never block on this, so any failure just yields no hits.

export type Hit = { label: string; lat: number; lon: number }

type RawResult = {
  name?: unknown
  latitude?: unknown
  longitude?: unknown
  country?: unknown
  admin1?: unknown
}

/** Pure parsing of the API's JSON, so the tests need no network. */
export function toHits(json: unknown): Hit[] {
  const results = (json as { results?: unknown })?.results
  if (!Array.isArray(results)) return []

  const hits: Hit[] = []
  for (const r of results as RawResult[]) {
    if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number') continue
    const parts = [r.name, r.admin1, r.country].filter((p): p is string => typeof p === 'string' && p.length > 0)
    hits.push({ label: parts.join(', '), lat: r.latitude, lon: r.longitude })
  }
  return hits
}

export async function geocode(query: string): Promise<Hit[]> {
  const q = query.trim()
  if (q.length < 2) return []

  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en`, {
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return []
    return toHits(await res.json())
  } catch {
    return []
  }
}
