import Link from 'next/link'
import { PageHeader } from '@/components/pos'
import { db } from '@/core/db'
import { getModule, getModules } from '@/core/modules'
import { closest, search, type SearchHit } from '@/core/search'
import { ownerToday } from '@/core/today'
import { cn } from '@/lib/utils'
import { QuickSearchButton } from './QuickSearchButton'
import { Results, type Hit } from './Results'
import { SearchBox } from './SearchBox'

const daysAgo = (iso: string, todayIso: string) =>
  Math.max(
    0,
    Math.round((new Date(`${todayIso}T12:00:00`).getTime() - new Date(`${iso}T12:00:00`).getTime()) / 86_400_000),
  )

/**
 * What else is linked to the same skills, for the artboard's Related list.
 *
 * Through core.skill_links and core.entities, so it works across every module
 * without knowing what any of them hold: two things are related here when the
 * classifier put them under the same skill.
 */
async function relatedFor(ids: string[]): Promise<Map<string, { id: string; title: string; module: string }[]>> {
  if (ids.length === 0) return new Map()

  const { rows } = await db().query<{
    source: string
    id: string
    title: string
    module: string
  }>(
    `select mine.entity_ref as source, en.id, en.title, en.module
       from core.skill_links mine
       join core.skill_links theirs
         on theirs.skill_id = mine.skill_id and theirs.entity_ref <> mine.entity_ref
       join core.entities en on en.id = theirs.entity_ref
      where mine.entity_ref = any($1)
        and mine.classified_by <> 'unclassified'
      group by mine.entity_ref, en.id, en.title, en.module
      order by max(theirs.confidence) desc
      limit 200`,
    [ids],
  )

  const out = new Map<string, { id: string; title: string; module: string }[]>()
  for (const r of rows) {
    const seen = out.get(r.source) ?? []
    if (seen.length < 5 && !seen.some((x) => x.id === r.id)) {
      out.set(r.source, [...seen, { id: r.id, title: r.title, module: r.module }])
    }
  }
  return out
}

/** Skill names per entity, fetched for the page of hits rather than joined in. */
async function skillsFor(ids: string[]): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map()

  const { rows } = await db().query<{ entity_ref: string; skill_id: string }>(
    `select entity_ref, skill_id from core.skill_links
      where entity_ref = any($1) and classified_by <> 'unclassified'
      order by confidence desc`,
    [ids],
  )

  const out = new Map<string, string[]>()
  for (const r of rows) out.set(r.entity_ref, [...(out.get(r.entity_ref) ?? []), r.skill_id])
  return out
}

function decorate(
  hits: SearchHit[],
  skills: Map<string, string[]>,
  related: Map<string, { id: string; title: string; module: string }[]>,
  todayIso: string,
): Hit[] {
  return hits.map((h) => ({
    id: h.id,
    module: h.module,
    moduleLabel: getModule(h.module)?.nav.label ?? h.module,
    entityType: h.entityType,
    title: h.title,
    snippet: h.snippet,
    score: h.score,
    daysAgo: daysAgo(h.updatedAt, todayIso),
    skills: skills.get(h.id) ?? [],
    related: (related.get(h.id) ?? []).map((r) => ({
      ...r,
      moduleLabel: getModule(r.module)?.nav.label ?? r.module,
    })),
  }))
}

export default async function SearchPage({ searchParams }: PageProps<'/search'>) {
  const params = await searchParams
  const query = typeof params.q === 'string' ? params.q : ''
  const scope = typeof params.module === 'string' ? params.module : undefined
  const open = typeof params.open === 'string' ? params.open : null

  // Scope counts come from an unscoped search, so the chips can show what each
  // module holds for this query rather than only the scope you are already in.
  const [result, todayIso] = await Promise.all([
    query ? search(query, { limit: 100 }) : Promise.resolve({ hits: [], mode: 'text' as const }),
    ownerToday(),
  ])
  const all = result.hits
  const scoped = scope ? all.filter((h) => h.module === scope) : all
  const fallback = query && scoped.length === 0 ? await closest(query) : []

  // A guessed answer is presented as a guess, whatever it found. The words
  // matched nothing, so these are nearest neighbours, and rendering them as
  // results claims a match that was never made.
  const guessing = result.mode === 'guessed' || (scoped.length === 0 && fallback.length > 0)

  const shown = scoped.length > 0 ? scoped : fallback
  const [skills, related] = await Promise.all([
    skillsFor(shown.map((h) => h.id)),
    relatedFor(shown.map((h) => h.id)),
  ])
  const hits = decorate(shown, skills, related, todayIso)
  const top = hits[0]?.score || 1

  const counts = new Map<string, number>()
  for (const h of all) counts.set(h.module, (counts.get(h.module) ?? 0) + 1)
  const chipModules = query ? getModules().filter((m) => counts.has(m.id)) : getModules()

  return (
    <div>
      <PageHeader eyebrow="Search" title="Search" hideTitle search={false} status={<QuickSearchButton />} />

      <div className="mx-auto w-full max-w-[880px]">
        <SearchBox initial={query} />

        <div className="mt-3 flex flex-wrap gap-1.5">
          <ScopeChip href={`/search${query ? `?q=${encodeURIComponent(query)}` : ''}`} active={!scope}>
            Everything
            {query && <span className="num ml-1.5 text-caption-1">{all.length}</span>}
          </ScopeChip>
          {chipModules.map((m) => (
            <ScopeChip
              key={m.id}
              href={query ? `/search?q=${encodeURIComponent(query)}&module=${m.id}` : '/search'}
              active={scope === m.id}
            >
              {m.nav.label}
              {query && <span className="num ml-1.5 text-caption-1">{counts.get(m.id)}</span>}
            </ScopeChip>
          ))}
        </div>

        {query && result.mode === 'degraded' && (
          <p className="mt-4 rounded-control bg-orange/15 px-3 py-2 text-footnote text-orange-text">
            Word matches only. Meaning was worth checking here but Voyage was out of requests,
            which is three a minute on the free tier. Try again in a moment.
          </p>
        )}

        {query && (
          <div className="pb-7 pt-[22px]">
            {guessing && hits.length > 0 && (
              <p className="mb-3.5 text-footnote text-secondary-label">
                Nothing matched <span className="text-label">&ldquo;{query}&rdquo;</span>
                {scope ? ` in ${getModule(scope)?.nav.label ?? scope}` : ''}. Closest matches:
              </p>
            )}
            <Results hits={hits} query={query} top={top} openId={open} />
          </div>
        )}
      </div>
    </div>
  )
}

function ScopeChip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex h-11 items-center rounded-capsule px-3.5 text-footnote font-medium leading-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring)',
        active ? 'bg-accent/15 text-accent' : 'bg-fill-4 text-label/70 hover:text-label',
      )}
    >
      {children}
    </Link>
  )
}
