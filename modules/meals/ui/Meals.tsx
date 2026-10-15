'use client'

import Link from 'next/link'
import { Fragment, useEffect, useRef, useState, useTransition } from 'react'
import {
  ActionButton,
  Card,
  Chip,
  Eyebrow,
  MetricStrip,
  MetricTile,
  PageHeader,
  PillGroup,
  StatusChip,
  fieldClass,
  useToast,
  type SkillLink,
} from '@/components/pos'
import { useSearchState } from '@/components/pos/searchState'
import { Segments } from '@/components/pos/Segments'
import { HIT } from '@/components/pos/button-classes'
import { cn } from '@/lib/utils'
import { standing, total, type Macros } from '../macros'
import { scaleQuantity, servingFactor } from '../scale'
import { decideRecipe, fillWeek, importRecipe, logAdhoc, markEaten, setFavourite, type ActionResult } from './actions'
import type { IngredientRow } from '../data'
import { GroceryDrawer, PickDrawer, RecipeDrawer } from './Drawers'
import { PasteForm, RecipeForm } from './RecipeForm'
import { startOfWeek, type WeekStart } from '@/core/clock'

export type MealsData = {
  todayIso: string
  /** The owner's week start (core/clock.ts startOfWeek). */
  weekStart: WeekStart
  /** From the Fitness module through the registry, or null when it is absent. */
  kcalTarget: number | null
  recipes: {
    id: string
    name: string
    sourceUrl: string
    notes: string
    servings: number
    timeMinutes: number
    costCents: number
    macros: Macros
    tags: string[]
    favourite: boolean
    status: string
    ingredients: IngredientRow[]
    steps: string[]
    /** How a pasted draft was read: 'rule', 'model', or null for typed and imported. */
    classifiedBy: string | null
    confidence: number | null
    entityRef: string | null
    skills: SkillLink[]
  }[]
  plan: {
    id: string
    recipeId: string | null
    label: string
    onDate: string
    slot: string
    servings: number
    eaten: boolean
    macros: Macros | null
  }[]
  /** Every skill in the tree, id and name. From getSkillNames() on the page. */
  skills: [string, string][]
}

export type Recipe = MealsData['recipes'][number]
export type Entry = MealsData['plan'][number]
export type Slot = (typeof SLOTS)[number]

export const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const
// Sunday first, as getUTCDay() counts; the grid starts on the owner's day.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// The artboard's filter order: how a recipe cooks, then when it is eaten.
const TAG_ORDER = ['quick', 'high-protein', 'batch', 'prep-ahead', 'veg', 'breakfast', 'lunch', 'dinner', 'snack']

export const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const dateOf = (iso: string) => new Date(`${iso}T12:00:00`)
/** "Sep 7" */
const shortDate = (iso: string) => `${MONTHS[dateOf(iso).getMonth()]} ${dateOf(iso).getDate()}`
export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/** The whole recipe's cost is stored; a serving of it is what a slot costs. */
export const costOf = (recipe: Recipe | undefined, servings: number) =>
  recipe ? Math.round((recipe.costCents / recipe.servings) * servings) : 0

export function Meals({ data }: { data: MealsData }) {
  const { params, set: setParams } = useSearchState()
  const tab = params.get('tab') === 'recipes' ? 'recipes' : 'week'

  const [pending, start] = useTransition()
  const toast = useToast()

  const run = (action: () => Promise<ActionResult>, ok?: string) =>
    start(async () => {
      const result = await action()
      if (!result.ok) toast(result.error)
      else if (ok) toast(ok)
    })

  const byId = (id: string | null) => data.recipes.find((r) => r.id === id)

  // Which week is on screen, as an offset from this one. In the URL, so a
  // week you paged to survives a refresh and can be linked to.
  const offset = Number(params.get('week') ?? 0) || 0
  const first = addDays(startOfWeek(data.todayIso, data.weekStart), offset * 7)
  const week = Array.from({ length: 7 }, (unused, i) => addDays(first, i))
  const dayName = (iso: string) => DAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()]
  const thisWeek = offset === 0

  const ready = data.recipes.filter((r) => r.status === 'ready')
  const drafts = data.recipes.filter((r) => r.status === 'draft')
  const inWeek = data.plan.filter((m) => m.onDate >= week[0] && m.onDate <= week[6])
  const entryAt = (iso: string, slot: string) => inWeek.find((p) => p.onDate === iso && p.slot === slot)

  const dayTotal = (iso: string) => {
    const entries = inWeek.filter((p) => p.onDate === iso)
    const t = total(entries)
    return {
      ...t,
      n: entries.length,
      cost: entries.reduce((sum, e) => sum + costOf(byId(e.recipeId), e.servings), 0),
      time: entries.reduce((sum, e) => sum + (byId(e.recipeId)?.timeMinutes ?? 0), 0),
    }
  }
  const days = week.map(dayTotal)
  const plannedDays = days.filter((d) => d.n > 0)
  const avg = (key: 'kcal' | 'protein') =>
    plannedDays.length ? Math.round(plannedDays.reduce((a, d) => a + d[key], 0) / plannedDays.length) : 0
  const weekCost = days.reduce((a, d) => a + d.cost, 0)
  const cooked = inWeek.filter((e) => e.eaten && e.recipeId).length
  const target = data.kcalTarget
  const kcalStanding = target === null ? 'none' : standing(avg('kcal'), target)

  // Today: the slots, what was eaten, and the one target the app has.
  const todayEntries = SLOTS.map((s) => entryAt(data.todayIso, s))
  const eatenToday = total(todayEntries.filter((e): e is Entry => e !== undefined), true)
  const firstEmptyToday = SLOTS.find((s, i) => !todayEntries[i])
  const [adhoc, setAdhoc] = useState('')
  // The week grid is 920px wide and scrolls inside its card below 1280px;
  // start it on today's column rather than on Monday, which was off screen.
  const weekScroll = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = weekScroll.current
    const col = box?.querySelector<HTMLElement>('[data-today]')
    if (!box || !col || box.scrollWidth <= box.clientWidth) return
    // Measured against the box, not offsetLeft: with no positioned ancestor
    // that counts from the body and includes the rail.
    const left = col.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft
    box.scrollLeft = Math.max(0, left - 72 - 8)
  }, [first, tab])
  const [ingestUrl, setIngestUrl] = useState('')
  const [ingesting, setIngesting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const cooking = byId(params.get('cook'))
  if (cooking) {
    return (
      <CookMode
        recipe={cooking}
        step={Math.max(0, Number(params.get('step') ?? 0))}
        servings={Number(params.get('servings') ?? cooking.servings) || cooking.servings}
        onChange={setParams}
      />
    )
  }

  const tag = params.get('tag') ?? 'All'
  const tags = [...new Set(ready.flatMap((r) => r.tags))].sort(
    (a, b) => (TAG_ORDER.indexOf(a) + 1 || 99) - (TAG_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b),
  )
  const shown = [...drafts, ...ready].filter(
    (r) => tag === 'All' || (tag === 'favorites' ? r.favourite : r.tags.includes(tag)),
  )
  const usage = (id: string) => inWeek.filter((e) => e.recipeId === id).length
  const groceryCount = new Set(inWeek.map((e) => e.recipeId).filter(Boolean)).size

  const weekLabel =
    (offset === 0 ? 'This week · ' : offset === -1 ? 'Last week · ' : offset === 1 ? 'Next week · ' : '') +
    `${shortDate(week[0])} – ${shortDate(week[6])}`

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            Meals <span className="text-secondary-label">/</span> {tab === 'week' ? 'Week' : 'Recipes'}
          </>
        }
        title="Meals"
        lede="Plan the week, log what you ate, and see calories against the Fitness estimate. Cooking a planned meal earns XP on the skills the recipe is linked to."
        status={
          <Eyebrow
            dot={kcalStanding === 'none' ? 'brand' : kcalStanding === 'on' ? 'ok' : 'warn'}
            className="whitespace-nowrap"
          >
            {inWeek.length} / 28 planned · {avg('protein')}g protein avg
          </Eyebrow>
        }
        actions={
          <>
            <ActionButton onClick={() => setParams({ drawer: 'grocery' }, { push: true })}>
              Grocery list <span className="num text-caption-1">{groceryCount}</span>
            </ActionButton>
            <ActionButton
              variant="solid"
              size="xl"
              disabled={pending}
              onClick={() => run(() => fillWeek(thisWeek ? data.todayIso : week[0], week[6]), 'Week filled from the library')}
            >
              {pending ? 'Suggesting…' : 'Suggest week'} <span aria-hidden="true">&rarr;</span>
            </ActionButton>
          </>
        }
        // The pair at pill size on the phone, as Insurance does, so the h1
        // keeps its room and the grocery list stays one tap away.
        phoneAction={
          <>
            <ActionButton size="pill" aria-label="Grocery list" onClick={() => setParams({ drawer: 'grocery' }, { push: true })}>
              Grocery <span className="num text-caption-1">{groceryCount}</span>
            </ActionButton>
            <ActionButton
              size="pill"
              variant="solid"
              disabled={pending}
              onClick={() => run(() => fillWeek(thisWeek ? data.todayIso : week[0], week[6]), 'Week filled from the library')}
            >
              {pending ? 'Suggesting…' : 'Suggest week'}
            </ActionButton>
          </>
        }
      />

      <Segments
        label="Meals views"
        value={tab}
        className="mt-[18px]"
        tabClassName="px-3.5"
        onChange={(next) => setParams({ tab: next === 'week' ? null : next, recipe: null, slot: null, tag: null })}
        tabs={[
          { value: 'week', label: 'Week', count: inWeek.length },
          { value: 'recipes', label: 'Recipes', count: ready.length },
        ]}
        end={
          tab === 'week' && (
            <div className="flex items-center gap-1 pb-2">
              <ActionButton size="sm" aria-label="Previous week" onClick={() => setParams({ week: offset - 1 === 0 ? null : String(offset - 1) })}>
                ←
              </ActionButton>
              <span className="num min-w-[150px] text-center text-caption-1 text-secondary-label">{weekLabel}</span>
              <ActionButton size="sm" aria-label="Next week" onClick={() => setParams({ week: offset + 1 === 0 ? null : String(offset + 1) })}>
                →
              </ActionButton>
            </div>
          )
        }
      >
        {tab === 'week' && (
          <div className="mt-[18px] space-y-[18px]">
            {thisWeek && (
              <section className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-5 gap-y-3 rounded-card bg-grouped-2 px-4 py-3 ring-1 ring-accent">
                <Eyebrow className="text-accent">
                  Today · {dayName(data.todayIso)} {shortDate(data.todayIso)}
                </Eyebrow>
                <div className="flex flex-wrap items-center gap-2">
                  <PillGroup
                    multiple
                    label="Eaten today"
                    options={SLOTS.map((s, i) => {
                      const entry = todayEntries[i]
                      return {
                        value: s,
                        label: `${cap(s)} · ${entry ? entry.label || 'Something' : 'nothing planned'}`,
                        disabled: !entry,
                      }
                    })}
                    value={SLOTS.filter((_, i) => todayEntries[i]?.eaten)}
                    onChange={(s) => {
                      const entry = todayEntries[SLOTS.indexOf(s)]
                      if (entry) run(() => markEaten(entry.id, !entry.eaten))
                    }}
                  />
                  {firstEmptyToday && (
                    <form
                      className="flex w-full min-w-0 max-w-[340px] gap-1"
                      onSubmit={(e) => {
                        e.preventDefault()
                        const label = adhoc.trim()
                        if (!label) return
                        run(() => logAdhoc(data.todayIso, firstEmptyToday, label), `Logged as ${firstEmptyToday}`)
                        setAdhoc('')
                      }}
                    >
                      <input
                        value={adhoc}
                        onChange={(e) => setAdhoc(e.target.value)}
                        placeholder="Ate something else? e.g. burrito"
                        className={cn(fieldClass, 'min-w-0 flex-1 py-1.5')}
                      />
                      <ActionButton type="submit" size="sm" className="self-center">
                        Log
                      </ActionButton>
                    </form>
                  )}
                </div>
                <Eyebrow>Eaten so far</Eyebrow>
                <div className="flex flex-wrap items-center gap-[18px]">
                  {(
                    [
                      ['Calories', eatenToday.kcal, target, ''],
                      ['Protein', eatenToday.protein, null, 'g'],
                      ['Carbs', eatenToday.carbs, null, 'g'],
                      ['Fat', eatenToday.fat, null, 'g'],
                    ] as const
                  ).map(([label, value, t, unit]) => (
                    <div key={label} className="min-w-[150px]">
                      <div className="flex justify-between gap-2 whitespace-nowrap text-caption-1 text-secondary-label">
                        <span>{label}</span>
                        <span className="num text-label">
                          {value.toLocaleString('en-US')}
                          {unit}
                          {t !== null && <span className="text-secondary-label"> / {t.toLocaleString('en-US')}</span>}
                        </span>
                      </div>
                      {t !== null && (
                        <div className="mt-1 h-[3px] bg-fill">
                          <div
                            className={cn('h-full', value > t * 1.1 ? 'bg-orange-text' : 'bg-accent')}
                            style={{ width: `${Math.min(100, (value / t) * 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                  {eatenToday.unknown > 0 && (
                    <span className="text-caption-1 text-secondary-label">{eatenToday.unknown} without a recipe, not counted</span>
                  )}
                </div>
              </section>
            )}

            <div ref={weekScroll} className="overflow-x-auto">
              <div className="grid min-w-[920px] grid-cols-[72px_repeat(7,minmax(120px,1fr))] gap-px overflow-hidden rounded-card bg-separator">
                <div className="bg-grouped-2 px-2 py-2.5" />
                {week.map((iso) => {
                  const isToday = iso === data.todayIso
                  return (
                    <div
                      key={iso}
                      data-today={isToday || undefined}
                      className={cn('flex flex-col border-t-2 bg-grouped-2 px-2 py-2.5', isToday ? 'border-accent' : 'border-transparent')}
                    >
                      <span className={cn('text-footnote font-medium', isToday ? 'text-accent' : 'text-secondary-label')}>{dayName(iso)}</span>
                      <span className={cn('mt-0.5 text-subheadline', isToday ? 'text-accent' : 'text-label')}>{dateOf(iso).getDate()}</span>
                    </div>
                  )
                })}

                {SLOTS.map((slot) => (
                  <Fragment key={slot}>
                    <div className="flex items-center bg-grouped-2 px-2 py-2.5">
                      <Eyebrow>{cap(slot)}</Eyebrow>
                    </div>
                    {week.map((iso) => {
                      const entry = entryAt(iso, slot)
                      const recipe = entry ? byId(entry.recipeId) : undefined
                      const past = iso < data.todayIso
                      return (
                        <div key={iso} className="min-h-[76px] bg-grouped-2 p-1.5">
                          {entry ? (
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() =>
                                setParams(
                                  { recipe: entry.recipeId, slot: entry.id, tab: null },
                                  entry.recipeId ? { push: true } : undefined,
                                )
                              }
                              onKeyDown={(e) =>
                                e.key === 'Enter' &&
                                setParams(
                                  { recipe: entry.recipeId, slot: entry.id, tab: null },
                                  entry.recipeId ? { push: true } : undefined,
                                )
                              }
                              className={cn(
                                'h-full cursor-grab rounded-control border bg-grouped-3 px-[9px] py-2 transition-colors duration-150 hover:border-gray',
                                entry.eaten ? 'border-accent' : 'border-separator',
                                past && !entry.eaten && 'border-dashed border-secondary-label',
                              )}
                            >
                              <div className="flex items-start justify-between gap-3 sm:gap-4">
                                <span className="min-w-0 text-footnote [overflow-wrap:anywhere]">
                                  {entry.label || 'Something'}
                                </span>
                                <button
                                  type="button"
                                  title="Mark eaten"
                                  aria-label="Mark eaten"
                                  aria-pressed={entry.eaten}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    run(() => markEaten(entry.id, !entry.eaten))
                                  }}
                                  className={cn(
                                    HIT,
                                    'grid size-6 shrink-0 place-items-center rounded-full border text-caption-1 transition-colors hover:border-label sm:size-4',
                                    entry.eaten ? 'border-accent bg-accent text-accent-fg' : 'border-secondary-label',
                                  )}
                                >
                                  {entry.eaten ? '✓' : ''}
                                </button>
                              </div>
                              <div className="num mt-1.5 flex flex-wrap gap-1.5 text-caption-1 text-secondary-label">
                                <span>{entry.macros ? Math.round(entry.macros.kcal * entry.servings) : 0} kcal</span>
                                <span className="text-accent">{entry.macros ? Math.round(entry.macros.protein * entry.servings) : 0}p</span>
                                <span>{recipe?.timeMinutes ?? 0}m</span>
                                <span>{money(costOf(recipe, entry.servings))}</span>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              aria-label="Plan a meal"
                              onClick={() => setParams({ pick: `${iso}:${slot}` }, { push: true })}
                              className="h-full min-h-16 w-full rounded-capsule border border-dashed border-gray text-callout text-secondary-label transition-colors duration-150 hover:border-accent hover:text-accent"
                            >
                              +
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </Fragment>
                ))}

                <div className="flex items-center bg-grouped-2 px-2 py-2.5">
                  <Eyebrow>Total</Eyebrow>
                </div>
                {days.map((d, i) => (
                  <div key={week[i]} className="flex flex-col gap-[5px] bg-grouped-2 px-2 py-2.5">
                    <div className="flex justify-between text-caption-1">
                      <span className="text-secondary-label">kcal</span>
                      <span className={cn('num', d.n === 0 ? 'text-secondary-label' : target !== null && d.kcal > target * 1.1 ? 'text-orange-text' : 'text-label')}>{d.kcal.toLocaleString('en-US')}</span>
                    </div>
                    {target !== null && (
                      <div className="h-0.5 bg-fill">
                        <div className={cn('h-full', d.kcal > target * 1.1 ? 'bg-orange-text' : 'bg-accent')} style={{ width: `${Math.min(100, (d.kcal / target) * 100)}%` }} />
                      </div>
                    )}
                    <div className="flex justify-between text-caption-1">
                      <span className="text-secondary-label">protein</span>
                      <span className={cn('num', d.n === 0 ? 'text-secondary-label' : 'text-label')}>{d.protein}g</span>
                    </div>
                    <span className="num mt-0.5 text-caption-1 text-secondary-label">
                      {money(d.cost)} · {d.time}m
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <MetricStrip>
              <MetricTile
                size="sm"
                label="Week · kcal / day"
                value={
                  <>
                    {avg('kcal').toLocaleString('en-US')}
                    {target !== null && <span className="text-footnote font-normal text-secondary-label"> / {target.toLocaleString('en-US')}</span>}
                  </>
                }
                delta={
                  target === null ? (
                    'No estimate: Fitness has no body weight'
                  ) : (
                    <>
                      {kcalStanding === 'over' ? 'Over the estimate on average' : kcalStanding === 'under' ? 'Under the estimate · plan more' : 'Within 10% of the estimate'}
                      {' · '}
                      <Link href="/fitness" className={`${HIT} inline-block hover:text-label`}>15 kcal a pound, from Fitness</Link>
                    </>
                  )
                }
              />
              <MetricTile size="sm" label="Week · protein / day" value={`${avg('protein')}g`} delta="per planned day" />
              <MetricTile size="sm" label="Week · cost" value={money(weekCost)} delta={`${money(Math.round(weekCost / 7))} per day`} />
              <MetricTile
                size="sm"
                label="Cooked"
                value={
                  <>
                    {cooked}
                    <span className="text-footnote font-normal text-secondary-label"> meals</span>
                  </>
                }
                delta={`${inWeek.length} planned`}
              />
            </MetricStrip>
          </div>
        )}

        {tab === 'recipes' && (
          <div className="mt-[18px] space-y-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <PillGroup
                label="Recipe tags"
                value={tag}
                onChange={(t) => setParams({ tag: t === 'All' ? null : t })}
                options={['All', 'favorites', ...tags].map((t) => ({ value: t, label: t === 'favorites' ? '★ favorites' : t }))}
              />
              <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
                <ActionButton size="sm" variant="accent" onClick={() => setParams({ form: 'new' }, { push: true })}>
                  New recipe
                </ActionButton>
                <ActionButton size="sm" onClick={() => setParams({ form: 'paste' }, { push: true })}>
                  Paste
                </ActionButton>
                <form
                  className="flex min-w-0 max-w-full gap-1"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const url = ingestUrl.trim()
                    if (!url || ingesting) return
                    setIngesting(true)
                    setImportError(null)
                    start(async () => {
                      const result = await importRecipe(url)
                      setIngesting(false)
                      // The reason stays on screen, not in a toast: the next
                      // thing to do about it is right beside it.
                      if (!result.ok) setImportError(result.error)
                      else {
                        setIngestUrl('')
                        setParams({ recipe: result.id, slot: null }, { push: true })
                      }
                    })
                  }}
                >
                  <input
                    aria-label="Recipe URL"
                    value={ingestUrl}
                    onChange={(e) => setIngestUrl(e.target.value)}
                    placeholder="Paste a recipe URL to ingest"
                    className={cn(fieldClass, 'w-[260px] max-w-full py-1.5')}
                  />
                  <ActionButton type="submit" size="sm" variant="accent" disabled={ingesting} className="self-center">
                    {ingesting ? 'Ingesting…' : 'Ingest'}
                  </ActionButton>
                </form>
              </div>
            </div>

            {importError && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-grouped-2 px-4 py-3">
                <p className="min-w-0 text-footnote text-label">{importError}</p>
                <div className="flex gap-1.5">
                  <ActionButton
                    size="sm"
                    variant="accent"
                    // Focus follows the failure, so a keyboard user is one key from the fix.
                    autoFocus
                    onClick={() => {
                      setImportError(null)
                      setParams({ form: 'paste' }, { push: true })
                    }}
                  >
                    Paste it instead
                  </ActionButton>
                  <ActionButton size="sm" variant="quiet" aria-label="Dismiss" onClick={() => setImportError(null)}>
                    ×
                  </ActionButton>
                </div>
              </div>
            )}

            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-3">
              {shown.map((r) => (
                <Card
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setParams({ recipe: r.id, slot: null }, { push: true })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setParams({ recipe: r.id, slot: null }, { push: true })
                    }
                  }}
                  className="min-w-0 cursor-pointer px-4 py-3.5 text-left transition-colors duration-200 hover:bg-fill-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-subheadline text-label">{r.name}</span>
                    <button
                      type="button"
                      title="Favorite"
                      aria-label={r.favourite ? 'Remove favorite' : 'Add favorite'}
                      onClick={(e) => {
                        e.stopPropagation()
                        run(() => setFavourite(r.id, !r.favourite))
                      }}
                      className={cn(HIT, 'num shrink-0 text-subheadline', r.favourite ? 'text-accent' : 'text-secondary-label')}
                    >
                      {r.favourite ? '★' : '☆'}
                    </button>
                  </div>
                  <div className="num mt-2 flex flex-wrap gap-2 text-caption-1 text-secondary-label">
                    <span>{r.macros.kcal} kcal</span>
                    <span className="text-accent">{r.macros.protein}g protein</span>
                    <span>{r.timeMinutes} min</span>
                    <span>{money(costOf(r, 1))}/serving</span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1">
                    {r.status === 'draft' && <StatusChip tone="warn">Draft</StatusChip>}
                    {r.tags.map((t) => (
                      <Chip key={t} tone="quiet">
                        {t}
                      </Chip>
                    ))}
                  </div>
                  {r.status === 'draft' ? (
                    <DraftActions id={r.id} run={run} className="mt-2.5" />
                  ) : (
                    <div className="mt-2.5 text-caption-1 text-secondary-label">
                      {usage(r.id) ? `${usage(r.id)}× this week` : 'Not planned this week'}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}
      </Segments>

      <PickDrawer
        pick={params.get('pick')}
        recipes={ready}
        onClose={() => setParams({ pick: null })}
        run={run}
      />
      <GroceryDrawer
        open={params.get('drawer') === 'grocery'}
        entries={inWeek}
        recipes={data.recipes}
        weekCost={weekCost}
        onClose={() => setParams({ drawer: null })}
      />
      <RecipeDrawer
        recipe={byId(params.get('recipe'))}
        entry={inWeek.find((e) => e.id === params.get('slot')) ?? data.plan.find((e) => e.id === params.get('slot'))}
        fromDate={thisWeek ? data.todayIso : week[0]}
        plan={data.plan}
        skills={data.skills}
        run={run}
        setParams={setParams}
      />
      {(params.get('form') === 'new' || byId(params.get('edit'))) && (
        <RecipeForm
          key={params.get('edit') ?? 'new'}
          recipe={byId(params.get('edit')) ?? null}
          // Cancel from Edit goes back to the recipe it was opened from.
          onClose={() => setParams({ form: null, edit: null, recipe: params.get('edit') })}
          onSaved={(id) => setParams({ form: null, edit: null, recipe: id, slot: null })}
        />
      )}
      {params.get('form') === 'paste' && (
        <PasteForm
          onClose={() => setParams({ form: null })}
          onDrafted={(id) => setParams({ form: null, recipe: id, slot: null, tab: 'recipes' })}
        />
      )}
    </>
  )
}

/** Accept or discard an imported recipe: on its card and in its drawer. */
export function DraftActions({
  id,
  run,
  className,
}: {
  id: string
  run: (action: () => Promise<ActionResult>, ok?: string) => void
  className?: string
}) {
  // Flips to a plain label the moment Accept or Discard is pressed, reverted
  // to the buttons on failure, same shape as ForgetPasskey.tsx: this
  // component is shared by a list card and a drawer, neither of which owns
  // the recipe array to remove the row from directly.
  const [decided, setDecided] = useState<'accepted' | 'discarded' | null>(null)

  if (decided) {
    return (
      <span className={cn('text-footnote text-secondary-label', className)} onClick={(e) => e.stopPropagation()}>
        {decided === 'accepted' ? 'Added' : 'Discarded'}
      </span>
    )
  }

  const decide = (accept: boolean) => {
    setDecided(accept ? 'accepted' : 'discarded')
    run(async () => {
      const result = await decideRecipe(id, accept)
      if (!result.ok) setDecided(null)
      return result
    }, accept ? 'Added to the library' : 'Discarded')
  }

  return (
    <div className={cn('flex gap-1.5', className)} onClick={(e) => e.stopPropagation()}>
      <ActionButton size="sm" variant="accent" onClick={() => decide(true)}>
        Accept
      </ActionButton>
      <ActionButton size="sm" onClick={() => decide(false)}>
        Discard
      </ActionButton>
    </div>
  )
}

/**
 * One step at a time, in type you can read from arm's length.
 *
 * The step and the servings live in the URL like every other piece of view
 * state in this app, so a reload in a kitchen does not lose your place and a
 * screenshot is honest about which step it was on.
 */
function CookMode({
  recipe,
  step,
  servings,
  onChange,
}: {
  recipe: MealsData['recipes'][number]
  step: number
  servings: number
  onChange: (next: Record<string, string | null>) => void
}) {
  // Keep the screen awake while cooking. A phone that sleeps between step four
  // and step five is the whole reason a paper recipe still beats a screen.
  // Best effort: it is refused in some browsers and absent in others, and
  // neither is a failure worth telling anyone about.
  useEffect(() => {
    let held: { release: () => Promise<void> } | null = null
    let cancelled = false

    const wakeLock = (navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> }
    }).wakeLock

    wakeLock
      ?.request('screen')
      .then((lock) => {
        if (cancelled) void lock.release()
        else held = lock
      })
      .catch(() => {})

    return () => {
      cancelled = true
      void held?.release().catch(() => {})
    }
  }, [])

  const last = recipe.steps.length - 1
  const current = Math.min(step, last)
  const factor = servingFactor(recipe.servings, servings)
  const scaled = recipe.ingredients.map((i) => ({ ...i, ...scaleQuantity(i.quantity, factor) }))
  const unscalable = scaled.filter((i) => i.quantity !== '' && !i.scaled)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>
            Cooking / step {current + 1} of {recipe.steps.length}
          </Eyebrow>
          <h2 className="text-headline text-label">{recipe.name}</h2>
        </div>
        <ActionButton onClick={() => onChange({ cook: null, step: null, servings: null })}>
          Close
        </ActionButton>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow>Servings</Eyebrow>
        <PillGroup
          label="Servings to cook"
          value={String(servings)}
          options={[1, 2, 4, 6, 8, 12].map((n) => ({ value: String(n), label: String(n) }))}
          onChange={(next) => onChange({ servings: next })}
        />
        <span className="text-footnote text-secondary-label">recipe makes {recipe.servings}</span>
      </div>

      <div className="flex flex-wrap items-start gap-x-6 gap-y-5">
        <div className="min-w-0 flex-[2_1_420px] space-y-4">
          <p className="text-title-1 text-label">
            {recipe.steps[current]}
          </p>

          <div className="flex flex-wrap gap-2">
            <ActionButton
              disabled={current === 0}
              onClick={() => onChange({ step: String(current - 1) })}
            >
              Back
            </ActionButton>
            <ActionButton
              variant="brand"
              disabled={current === last}
              onClick={() => onChange({ step: String(current + 1) })}
            >
              Next step
            </ActionButton>
            {current === last && (
              <ActionButton onClick={() => onChange({ cook: null, step: null, servings: null })}>
                Done
              </ActionButton>
            )}
          </div>

          <div className="flex gap-1" aria-hidden>
            {recipe.steps.map((s, i) => (
              <span
                key={s}
                className={cn('h-0.5 flex-1', i <= current ? 'bg-accent' : 'bg-fill')}
              />
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-[1_1_240px] space-y-2.5">
          <Eyebrow>Ingredients</Eyebrow>
          {scaled.map((i) => (
            <p key={i.item} className="text-subheadline text-label">
              <span className={cn('num', i.scaled && factor !== 1 && 'text-accent')}>{i.text}</span>
              {i.text ? ' ' : ''}
              {i.item}
            </p>
          ))}

          {factor !== 1 && unscalable.length > 0 && (
            <p className="border-t border-separator pt-2 text-footnote text-secondary-label">
              {unscalable.map((i) => i.item).join(', ')}{' '}
              {unscalable.length === 1 ? 'is' : 'are'} written as words rather than a number, so{' '}
              {unscalable.length === 1 ? 'it is' : 'they are'} unchanged. Half a splash is not a
              measurement.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
