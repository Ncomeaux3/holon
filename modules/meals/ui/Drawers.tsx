'use client'

import { useState } from 'react'
import { ActionButton, Chip, Eyebrow, MetricStrip, MetricTile, Overlay, Row, RowList, SkillPicker, StatusChip } from '@/components/pos'
import { cn } from '@/lib/utils'
import { markEaten, planMeal, setFavourite, type ActionResult } from './actions'
import {
  cap,
  costOf,
  DraftActions,
  money,
  SLOTS,
  type Entry,
  type Recipe,
  type Slot,
} from './Meals'

type Run = (action: () => Promise<ActionResult>, ok?: string) => void

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Pick a recipe for an empty slot: favourites, then what is tagged for the
 * slot, then the rest, each by protein. `pick` is "YYYY-MM-DD:slot".
 */
export function PickDrawer({
  pick,
  recipes,
  onClose,
  run,
}: {
  pick: string | null
  recipes: Recipe[]
  onClose: () => void
  run: Run
}) {
  if (!pick) return null
  const [onDate, slot] = pick.split(':') as [string, Slot]
  const rank = (r: Recipe) => (r.favourite ? 0 : r.tags.includes(slot) ? 1 : 2)
  const list = [...recipes].sort((a, b) => rank(a) - rank(b) || b.macros.protein - a.macros.protein)

  return (
    <Overlay open onClose={onClose} eyebrow="Meals / Pick">
      <div className="space-y-[18px]">
        <div>
          <h2 className="text-title-2 text-label">Pick a recipe</h2>
          <p className="mt-1.5 text-footnote text-secondary-label">
            {DOW[new Date(`${onDate}T12:00:00`).getDay()]} · {cap(slot)} · favorites first, then by protein
          </p>
        </div>
        <RowList>
          {list.map((r) => (
            <Row
              key={r.id}
              title={`${r.favourite ? '★' : '·'} ${r.name}`}
              date={`${r.macros.kcal} kcal · ${r.macros.protein}p · ${r.timeMinutes}m`}
              onClick={() => {
                run(() => planMeal(onDate, slot, r.id))
                onClose()
              }}
            />
          ))}
        </RowList>
      </div>
    </Overlay>
  )
}

/**
 * The shopping list for the week on screen, grouped by recipe with the
 * quantities as written. Ticks are for the aisle and do not outlive the page.
 */
export function GroceryDrawer({
  open,
  entries,
  recipes,
  weekCost,
  onClose,
}: {
  open: boolean
  entries: Entry[]
  recipes: Recipe[]
  weekCost: number
  onClose: () => void
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  if (!open) return null

  const groups = recipes
    .map((r) => ({ recipe: r, n: entries.filter((e) => e.recipeId === r.id).length }))
    .filter((g) => g.n > 0)
  const items = groups.reduce((a, g) => a + g.recipe.ingredients.length, 0)
  const done = Object.values(checked).filter(Boolean).length

  return (
    <Overlay open onClose={onClose} eyebrow="Meals / Grocery list">
      <div className="space-y-[18px]">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-title-2 text-label">Grocery list</h2>
            <p className="mt-1.5 text-footnote text-secondary-label">
              {items} items · {done} checked · est. {money(weekCost)}
            </p>
          </div>
          <ActionButton size="sm" onClick={() => setChecked({})}>
            Uncheck all
          </ActionButton>
        </div>

        {groups.length === 0 && (
          <div className="rounded-card border border-dashed border-gray-3 p-[30px] text-center">
            <p className="text-title-3 text-label">Nothing planned</p>
            <p className="mt-1.5 text-footnote text-secondary-label">Plan a meal and its ingredients appear here.</p>
          </div>
        )}

        {groups.map(({ recipe, n }) => (
          <div key={recipe.id}>
            <div className="flex items-baseline justify-between border-b border-separator pb-1.5">
              <span className="text-subheadline font-semibold text-label">{recipe.name}</span>
              <span className="num text-caption-1 text-secondary-label">
                {n}× · serves {recipe.servings}
              </span>
            </div>
            <div className="flex flex-col">
              {recipe.ingredients.map((ing, i) => {
                const key = `${recipe.id}:${i}`
                const on = !!checked[key]
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setChecked((c) => ({ ...c, [key]: !c[key] }))}
                    className="flex min-h-11 items-center justify-between gap-2.5 border-b border-separator py-1.5 text-left"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span aria-hidden className={cn('size-3 shrink-0 rounded-full border', on ? 'border-accent bg-accent' : 'border-gray')} />
                      <span className={cn('text-subheadline', on ? 'text-secondary-label line-through' : 'text-label')}>{ing.item}</span>
                    </span>
                    <span className="num shrink-0 text-footnote text-secondary-label">
                      {ing.quantity}
                      {n > 1 && recipe.servings === 1 && ing.quantity ? ` × ${n}` : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        <p className="text-caption-1 text-secondary-label">
          Built from the planned meals this week. Quantities are as written and are not added up.
        </p>
      </div>
    </Overlay>
  )
}

/**
 * A recipe, and what to do with it: in slot mode (opened from a planned cell)
 * the footer ticks, swaps or removes it; from the library it can be planned
 * into the next open slot; a draft is accepted or discarded.
 */
export function RecipeDrawer({
  recipe,
  entry,
  fromDate,
  plan,
  skills,
  run,
  setParams,
}: {
  recipe: Recipe | undefined
  entry: Entry | undefined
  /** The first day "Next open" looks at: today this week, Monday on a week paged to. */
  fromDate: string
  plan: Entry[]
  skills: [string, string][]
  run: Run
  setParams: (next: Record<string, string | null>) => void
}) {
  if (!recipe) return null
  const onClose = () => setParams({ recipe: null, slot: null })
  const draft = recipe.status === 'draft'
  const slots = SLOTS.filter((s) => recipe.tags.includes(s) || (s === 'lunch' && recipe.tags.includes('dinner')))
  const addTo = slots.length ? slots : [...SLOTS]

  const nextOpen = (slot: Slot) => {
    for (let i = 0; i < 7; i++) {
      const iso = new Date(Date.parse(`${fromDate}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10)
      if (!plan.some((e) => e.onDate === iso && e.slot === slot)) {
        run(() => planMeal(iso, slot, recipe.id), `Planned for ${slot}`)
        setParams({ recipe: null, slot: null, tab: null })
        return
      }
    }
    run(async () => ({ ok: false, error: `Every ${slot} this week is planned` }))
  }

  const source = recipe.sourceUrl.replace(/^https?:\/\/(www\.)?/, '')

  return (
    <Overlay
      open
      onClose={onClose}
      eyebrow={`Meals / ${recipe.name}`}
      footer={
        draft ? (
          <DraftActions id={recipe.id} run={run} />
        ) : entry ? (
          <>
            <div className="flex gap-2">
              <ActionButton variant="accent" onClick={() => run(() => markEaten(entry.id, !entry.eaten))}>
                {entry.eaten ? 'Eaten ✓ · undo' : 'Mark eaten'}
              </ActionButton>
              <ActionButton onClick={() => setParams({ recipe: null, slot: null, pick: `${entry.onDate}:${entry.slot}` })}>
                Swap
              </ActionButton>
              <ActionButton onClick={() => setParams({ cook: recipe.id, step: '0', recipe: null, slot: null })}>
                Cook
              </ActionButton>
            </div>
            <ActionButton
              variant="danger"
              onClick={() => {
                run(() => planMeal(entry.onDate, entry.slot as Slot, null))
                onClose()
              }}
            >
              Remove from plan
            </ActionButton>
          </>
        ) : (
          <>
            <ActionButton onClick={() => setParams({ cook: recipe.id, step: '0', recipe: null, slot: null })}>
              Cook
            </ActionButton>
            <span className="text-caption-1 text-secondary-label">Use &quot;Add to&quot; above to plan it this week.</span>
          </>
        )
      }
    >
      <div className="space-y-[18px]">
        <div>
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-title-2 text-label">{recipe.name}</h2>
            <div className="flex shrink-0 gap-1.5">
              <ActionButton size="sm" onClick={() => setParams({ edit: recipe.id, recipe: null, slot: null })}>
                Edit
              </ActionButton>
              <ActionButton
                size="sm"
                onClick={() => run(() => setFavourite(recipe.id, !recipe.favourite))}
                className={cn('num', recipe.favourite ? 'text-accent' : 'text-secondary-label')}
              >
                {recipe.favourite ? '★ Favorite' : '☆ Add favorite'}
              </ActionButton>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {draft && <StatusChip tone="warn">Draft</StatusChip>}
            {draft && recipe.classifiedBy && (
              <Chip tone="quiet">
                {recipe.classifiedBy === 'model'
                  ? `Read by the model, ${Math.round((recipe.confidence ?? 0) * 100)}% sure`
                  : recipe.confidence !== null && recipe.confidence < 1
                    ? 'Read by rules, partly'
                    : 'Read by rules'}
              </Chip>
            )}
            {recipe.tags.map((t) => (
              <Chip key={t} tone="quiet">
                {t}
              </Chip>
            ))}
          </div>
          {recipe.sourceUrl && (
            <a
              href={recipe.sourceUrl}
              target="_blank"
              rel="noopener"
              className="flex min-h-11 items-center text-footnote text-secondary-label hover:text-label"
            >
              <span className="truncate">{source} ↗</span>
            </a>
          )}
        </div>

        <MetricStrip className="grid-cols-2 sm:grid-cols-4">
          <MetricTile size="sm" label="kcal" value={recipe.macros.kcal} />
          <MetricTile size="sm" label="Protein" value={`${recipe.macros.protein}g`} className="[&>p]:text-accent" />
          <MetricTile
            size="sm"
            label="Carbs · fat"
            value={
              <>
                {recipe.macros.carbs}
                <Unit>g</Unit> · {recipe.macros.fat}
                <Unit>g</Unit>
              </>
            }
          />
          <MetricTile
            size="sm"
            label="Time · cost"
            value={
              <>
                {recipe.timeMinutes}
                <Unit>m</Unit> · {money(costOf(recipe, 1))}
              </>
            }
          />
        </MetricStrip>

        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <span className="text-footnote text-secondary-label">Serves {recipe.servings} · per-serving values</span>
          {!draft && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Eyebrow>Add to</Eyebrow>
              {addTo.map((s) => (
                <ActionButton key={s} size="sm" onClick={() => nextOpen(s)}>
                  Next open {s}
                </ActionButton>
              ))}
            </div>
          )}
        </div>

        <div>
          <Eyebrow>Ingredients</Eyebrow>
          <div className="mt-1.5 flex flex-col">
            {recipe.ingredients.map((ing, i) => (
              <div key={`${ing.item}-${i}`} className="flex justify-between gap-2.5 border-b border-separator py-2 text-subheadline text-label">
                <span>{ing.item}</span>
                <span className="num text-footnote text-secondary-label">{ing.quantity}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <Eyebrow>Steps</Eyebrow>
          <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5 text-subheadline text-label">
            {recipe.steps.map((s, i) => (
              <li key={`${i}-${s}`}>{s}</li>
            ))}
          </ol>
        </div>

        <div>
          <Eyebrow>Linked skills</Eyebrow>
          {recipe.entityRef ? (
            <SkillPicker entityRef={recipe.entityRef} links={recipe.skills} skills={skills} className="mt-2" />
          ) : (
            <p className="mt-2 text-footnote text-secondary-label">Nothing matched yet.</p>
          )}
        </div>

        {recipe.notes && (
          <div>
            <Eyebrow>Notes</Eyebrow>
            <p className="mt-1.5 text-subheadline text-label">{recipe.notes}</p>
          </div>
        )}
      </div>
    </Overlay>
  )
}

function Unit({ children }: { children: string }) {
  return <span className="text-caption-1 text-secondary-label">{children}</span>
}
