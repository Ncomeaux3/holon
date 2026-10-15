'use client'

import { useId, useState, useTransition } from 'react'
import { ActionButton, Eyebrow, Field, Overlay, fieldClass, submitOnModEnter, useFormErrors, useToast } from '@/components/pos'
import { parseNumber } from '@/core/numbers'
import { cn } from '@/lib/utils'
import { forGrams, gramsOf, perServing, type Macros } from '../macros'
import { pasteRecipe, saveRecipe } from './actions'
import { IngredientSearch, type Food } from './IngredientSearch'
import { SLOTS, cap, type Recipe } from './Meals'

type Row = {
  key: number
  quantity: string
  item: string
  /** The USDA food picked for this row, per 100 g. Null when unmatched. */
  match: { fdcId: number; description: string; per100: Macros } | null
  grams: string
}

let nextKey = 0
const blank = (): Row => ({ key: nextKey++, quantity: '', item: '', match: null, grams: '' })

/** The row's macros for its grams, or null when it has no match or no grams yet. */
const macrosOf = (row: Row): Macros | null => {
  const grams = parseNumber(row.grams)
  return row.match && grams && grams > 0 ? forGrams(row.match.per100, grams) : null
}

/** What the rows say, for the unsaved-changes check. Keys and match names are not edits. */
const signature = (rows: Row[]) => JSON.stringify(rows.map((r) => [r.quantity, r.item, r.match?.fdcId ?? null, r.grams]))

const whole = (text: string) => {
  const n = parseNumber(text)
  return n === null ? null : Math.round(n)
}

/**
 * New recipe and Edit: one form over write_recipe. A typed recipe is saved
 * ready, not a draft; editing a draft keeps it a draft until it is accepted.
 */
export function RecipeForm({ recipe, onClose, onSaved }: { recipe: Recipe | null; onClose: () => void; onSaved: (id: string) => void }) {
  const initial = {
    name: recipe?.name ?? '',
    servings: String(recipe?.servings ?? 2),
    time: recipe?.timeMinutes ? String(recipe.timeMinutes) : '',
    slots: SLOTS.filter((s) => recipe?.tags.includes(s)),
    otherTags: (recipe?.tags ?? []).filter((t) => !(SLOTS as readonly string[]).includes(t)).join(', '),
    notes: recipe?.notes ?? '',
    steps: (recipe?.steps ?? []).join('\n'),
    kcal: recipe?.macros.kcal ? String(recipe.macros.kcal) : '',
    protein: recipe?.macros.protein ? String(recipe.macros.protein) : '',
    carbs: recipe?.macros.carbs ? String(recipe.macros.carbs) : '',
    fat: recipe?.macros.fat ? String(recipe.macros.fat) : '',
  }
  const [d, setD] = useState(initial)
  const [rows, setRows] = useState<Row[]>(() =>
    recipe?.ingredients.length
      ? recipe.ingredients.map((i) => ({
          key: nextKey++,
          quantity: i.quantity,
          item: i.item,
          // Per 100 g back out of the stored amount, so changing the grams
          // rescales without searching USDA again.
          match:
            i.fdcId && i.grams && i.macros
              ? {
                  fdcId: i.fdcId,
                  // The food's own name is not stored; the id is.
                  description: '',
                  per100: {
                    kcal: (i.macros.kcal * 100) / i.grams,
                    protein: (i.macros.protein * 100) / i.grams,
                    carbs: (i.macros.carbs * 100) / i.grams,
                    fat: (i.macros.fat * 100) / i.grams,
                  },
                }
              : null,
          grams: i.grams ? String(i.grams) : '',
        }))
      : [blank()],
  )
  const [rowsAtOpen] = useState(() => signature(rows))
  const [searching, setSearching] = useState<number | null>(null)
  // The macro fields follow the matched ingredients until the owner types in
  // one. A recipe saved with its own numbers starts with them, not the sum.
  const [auto, setAuto] = useState(!recipe || recipe.macros.kcal === 0)

  const [pending, start] = useTransition()
  const toast = useToast()
  const formId = useId()

  const servings = whole(d.servings) ?? 0
  const filled = rows.filter((r) => r.item.trim())
  const computed = perServing(filled.map((r) => ({ macros: macrosOf(r) })), Math.max(1, servings))
  const shown = (key: 'kcal' | 'protein' | 'carbs' | 'fat') => (auto && computed.matched > 0 ? String(computed.macros[key]) : d[key])

  const dirty =
    (Object.keys(initial) as (keyof typeof initial)[]).some((k) => String(d[k]) !== String(initial[k])) ||
    signature(rows) !== rowsAtOpen

  const { errors, ref: formRef, submit } = useFormErrors(() => ({
    name: d.name.trim() ? undefined : 'Name is required',
    servings: servings >= 1 && servings <= 100 ? undefined : 'Servings is a whole number from 1 to 100',
    time: !d.time.trim() || (whole(d.time) ?? -1) >= 0 ? undefined : 'Minutes, as a number',
  }))

  /** After the panel closes the control that held focus is gone; put it somewhere useful. */
  const focusSoon = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus())

  const set = (key: number, patch: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const pick = (row: Row, food: Food) => {
    set(row.key, {
      match: { fdcId: food.fdcId, description: food.description, per100: food.per100 },
      grams: row.grams || String(gramsOf(row.quantity) ?? ''),
    })
    setSearching(null)
    focusSoon(`grams-${row.key}`)
  }

  const send = () =>
    start(async () => {
      // A dropped connection rejects the action; caught here so the form and
      // what was typed in it survive, rather than error.tsx taking the page.
      try {
        const num = (key: 'kcal' | 'protein' | 'carbs' | 'fat') => Math.max(0, whole(shown(key)) ?? 0)
        const result = await saveRecipe({
          ...(recipe && { id: recipe.id }),
          name: d.name.trim(),
          servings,
          time_minutes: whole(d.time) ?? 0,
          kcal: num('kcal'),
          protein_g: num('protein'),
          carbs_g: num('carbs'),
          fat_g: num('fat'),
          tags: [...d.slots, ...d.otherTags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)].slice(0, 20),
          notes: d.notes.trim(),
          ingredients: filled.map((r) => {
            const m = macrosOf(r)
            return {
              item: r.item.trim(),
              quantity: r.quantity.trim(),
              fdc_id: m ? r.match!.fdcId : null,
              grams: m ? parseNumber(r.grams) : null,
              kcal: m?.kcal ?? null,
              protein_g: m?.protein ?? null,
              carbs_g: m?.carbs ?? null,
              fat_g: m?.fat ?? null,
            }
          }),
          steps: d.steps
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
        })
        if (!result.ok) toast(result.error)
        else {
          toast(recipe ? 'Saved.' : `Added. ${d.name.trim()}`)
          onSaved(result.id)
        }
      } catch {
        toast('Not saved: the app could not be reached. Your recipe is still here; try again.')
      }
    })

  return (
    <Overlay
      open
      onClose={onClose}
      dirty={dirty}
      eyebrow={
        <>
          Meals <span className="text-secondary-label">/</span> {recipe ? 'Edit recipe' : 'New recipe'}
        </>
      }
      footer={
        <>
          <ActionButton variant="outline" size="md" onClick={onClose}>
            Cancel
          </ActionButton>
          <ActionButton variant="solid" disabled={pending} type="submit" form={formId}>
            {pending ? 'Saving…' : 'Save recipe'}
          </ActionButton>
        </>
      }
    >
      <form
        id={formId}
        ref={formRef}
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (submit()) send()
        }}
      >
        <Field label="Name" required error={errors.name}>
          <input
            aria-label="Recipe name"
            value={d.name}
            onChange={(e) => setD({ ...d, name: e.target.value })}
            placeholder="Sheet pan chicken thighs"
            maxLength={200}
            className={fieldClass}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Servings" required error={errors.servings}>
            <input
              aria-label="Servings"
              inputMode="numeric"
              value={d.servings}
              onChange={(e) => setD({ ...d, servings: e.target.value })}
              className={fieldClass}
            />
          </Field>
          <Field label="Minutes" error={errors.time} hint="Start to plate">
            <input
              aria-label="Minutes"
              inputMode="numeric"
              value={d.time}
              onChange={(e) => setD({ ...d, time: e.target.value })}
              placeholder="45"
              className={fieldClass}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-1.5">
          <Eyebrow>Ingredients</Eyebrow>
          <div aria-hidden className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] gap-1.5 text-caption-1 text-secondary-label">
            <span>Amount</span>
            <span>Ingredient</span>
          </div>
          {rows.map((row, i) => {
            const m = macrosOf(row)
            return (
              <div key={row.key} className="flex flex-col">
                <div className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)_auto] items-center gap-1.5">
                  <input
                    aria-label={`Ingredient ${i + 1} quantity`}
                    value={row.quantity}
                    onChange={(e) => set(row.key, { quantity: e.target.value })}
                    placeholder={i === 0 ? '600 g' : undefined}
                    maxLength={80}
                    className={fieldClass}
                  />
                  <input
                    aria-label={`Ingredient ${i + 1}`}
                    value={row.item}
                    onChange={(e) => set(row.key, { item: e.target.value })}
                    placeholder={i === 0 ? 'chicken thigh' : undefined}
                    maxLength={200}
                    className={fieldClass}
                  />
                  <div className="flex gap-1">
                    <ActionButton
                      id={`macros-${row.key}`}
                      size="sm"
                      disabled={!row.item.trim()}
                      aria-label={`Find macros for ingredient ${i + 1}`}
                      onClick={() => setSearching(searching === row.key ? null : row.key)}
                    >
                      Macros
                    </ActionButton>
                    <ActionButton
                      size="sm"
                      variant="quiet"
                      aria-label={`Remove ingredient ${i + 1}`}
                      onClick={() => setRows((all) => (all.length > 1 ? all.filter((r) => r.key !== row.key) : [blank()]))}
                    >
                      ×
                    </ActionButton>
                  </div>
                </div>

                {row.match && (
                  <div className="mt-1.5 flex flex-col gap-1.5 pl-1">
                    <span className="truncate text-footnote text-secondary-label">{row.match.description ? `USDA: ${row.match.description}` : `USDA match, food ${row.match.fdcId}`}</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-1.5 text-footnote text-secondary-label">
                        <input
                          id={`grams-${row.key}`}
                          aria-label={`Ingredient ${i + 1} grams`}
                          inputMode="decimal"
                          value={row.grams}
                          onChange={(e) => set(row.key, { grams: e.target.value })}
                          placeholder="grams"
                          className={cn(fieldClass, 'w-24')}
                        />
                        g
                      </label>
                      <span className="num text-footnote text-secondary-label">
                        {m ? `${m.kcal} kcal, ${m.protein}g protein` : 'Enter grams to count it'}
                      </span>
                      <ActionButton size="sm" variant="quiet" onClick={() => set(row.key, { match: null, grams: '' })}>
                        Clear
                      </ActionButton>
                    </div>
                  </div>
                )}

                {searching === row.key && (
                  <IngredientSearch initial={row.item} onPick={(food) => pick(row, food)} onCancel={() => {
                      setSearching(null)
                      focusSoon(`macros-${row.key}`)
                    }}
                  />
                )}
              </div>
            )
          })}
          <ActionButton size="sm" onClick={() => setRows((all) => [...all, blank()])} className="self-start">
            + Ingredient
          </ActionButton>
        </div>

        <Field label="Steps" hint="One step per line">
          <textarea
            aria-label="Steps"
            value={d.steps}
            onChange={(e) => setD({ ...d, steps: e.target.value })}
            onKeyDown={submitOnModEnter}
            rows={5}
            placeholder={'Heat the oven to 220 C.\nRoast the thighs 35 minutes.'}
            className={fieldClass}
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <Eyebrow>Per serving</Eyebrow>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {(
              [
                ['kcal', 'kcal'],
                ['protein', 'Protein g'],
                ['carbs', 'Carbs g'],
                ['fat', 'Fat g'],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  aria-label={label}
                  inputMode="numeric"
                  value={shown(key)}
                  onChange={(e) => {
                    // Typing takes the numbers over from the ingredient sum.
                    setD({ ...d, kcal: shown('kcal'), protein: shown('protein'), carbs: shown('carbs'), fat: shown('fat'), [key]: e.target.value })
                    setAuto(false)
                  }}
                  className={fieldClass}
                />
              </Field>
            ))}
          </div>
          {computed.matched > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-footnote text-secondary-label">
              <span>
                {auto ? 'From' : 'Ingredient sum uses'} {computed.matched} of {computed.of} ingredients
                {computed.matched < computed.of ? '. The rest count as nothing until matched.' : '.'}
              </span>
              {!auto && (
                <ActionButton size="sm" onClick={() => setAuto(true)}>
                  Use ingredient sum
                </ActionButton>
              )}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Eyebrow>Good for</Eyebrow>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Good for">
            {SLOTS.map((s) => {
              const on = d.slots.includes(s)
              return (
                <ActionButton
                  key={s}
                  size="sm"
                  aria-pressed={on}
                  variant={on ? 'accent' : undefined}
                  onClick={() => setD({ ...d, slots: on ? d.slots.filter((x) => x !== s) : [...d.slots, s] })}
                >
                  {cap(s)}
                </ActionButton>
              )
            })}
          </div>
        </div>

        <Field label="Other tags" hint="Comma separated, like high-protein, batch">
          <input
            aria-label="Other tags"
            value={d.otherTags}
            onChange={(e) => setD({ ...d, otherTags: e.target.value })}
            className={fieldClass}
          />
        </Field>

        <Field label="Notes">
          <textarea
            aria-label="Notes"
            value={d.notes}
            onChange={(e) => setD({ ...d, notes: e.target.value })}
            onKeyDown={submitOnModEnter}
            rows={2}
            maxLength={5000}
            className={fieldClass}
          />
        </Field>
      </form>
    </Overlay>
  )
}

/**
 * Pasted text to a draft. Rules read it first; only what they cannot place
 * goes to one Haiku call. Instagram links are not fetched (the page is behind
 * a login), so the caption is what gets pasted.
 */
export function PasteForm({ onClose, onDrafted }: { onClose: () => void; onDrafted: (id: string) => void }) {
  const [text, setText] = useState('')
  const [pending, start] = useTransition()
  const toast = useToast()
  const formId = useId()
  const { errors, ref: formRef, submit } = useFormErrors(() => ({
    text: !text.trim()
      ? 'Paste a recipe'
      : /^\s*https?:\/\/(www\.)?instagram\.com\//i.test(text)
        ? 'Instagram links cannot be read. Open the post, copy the caption, and paste that.'
        : undefined,
  }))

  return (
    <Overlay
      open
      narrow
      onClose={onClose}
      dirty={text.trim() !== ''}
      eyebrow={
        <>
          Meals <span className="text-secondary-label">/</span> Paste a recipe
        </>
      }
      footer={
        <>
          <ActionButton variant="outline" size="md" onClick={onClose}>
            Cancel
          </ActionButton>
          <ActionButton variant="solid" disabled={pending} type="submit" form={formId}>
            {pending ? 'Reading…' : 'Make draft'}
          </ActionButton>
        </>
      }
    >
      <form
        id={formId}
        ref={formRef}
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!submit()) return
          start(async () => {
            try {
              const result = await pasteRecipe(text)
              if (!result.ok) toast(result.error)
              else {
                toast('Draft ready to review')
                onDrafted(result.id)
              }
            } catch {
              toast('Not read: the app could not be reached. Your text is still here; try again.')
            }
          })
        }}
      >
        <Field
          label="Recipe text"
          required
          error={errors.text}
          hint="A copied page or an Instagram caption. The first line becomes the name. It lands as a draft for you to accept."
        >
          <textarea
            aria-label="Recipe text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={submitOnModEnter}
            rows={12}
            maxLength={20_000}
            placeholder={'Turkey chili\nServes 6\n900 g ground turkey\n2 cans kidney beans\n1. Brown the turkey.\n2. Simmer 30 minutes.'}
            className={fieldClass}
          />
        </Field>
      </form>
    </Overlay>
  )
}
