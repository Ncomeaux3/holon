'use client'

import { useEffect, useRef, useState } from 'react'
import { ActionButton, fieldClass } from '@/components/pos'
import { cn } from '@/lib/utils'
import type { Macros } from '../macros'

export type Food = { fdcId: number; description: string; dataType: string; per100: Macros }

/**
 * USDA matches for one ingredient: the top five for the typed name, macros per
 * 100 g. Reads /api/meals/foods, a GET route, so a slow USDA call never holds
 * the recipe's Save (a server action) behind it.
 */
export function IngredientSearch({
  initial,
  onPick,
  onCancel,
}: {
  initial: string
  onPick: (food: Food) => void
  onCancel: () => void
}) {
  const [q, setQ] = useState(initial)
  const [foods, setFoods] = useState<Food[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'done'>(initial.trim().length >= 2 ? 'loading' : 'idle')
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef('')

  /** Debounced: the fetch goes 300 ms after the last keystroke. */
  const schedule = (query: string) => {
    if (timer.current) clearTimeout(timer.current)
    latest.current = query
    timer.current = setTimeout(() => {
      fetch(`/api/meals/foods?q=${encodeURIComponent(query)}`)
        .then((r) => r.json() as Promise<{ foods: Food[]; error?: string }>)
        .then((body) => {
          // A slower answer to an earlier query must not replace a newer one.
          if (latest.current !== query) return
          setFoods(body.foods)
          setError(body.error ?? null)
          setState('done')
        })
        .catch(() => {
          if (latest.current !== query) return
          setError('USDA search failed. The ingredient still saves without a match.')
          setState('done')
        })
    }, 300)
  }

  const search = (value: string) => {
    setQ(value)
    const query = value.trim()
    if (query.length < 2) {
      if (timer.current) clearTimeout(timer.current)
      latest.current = ''
      setFoods([])
      setState('idle')
      return
    }
    setState('loading')
    schedule(query)
  }

  // The ingredient's own name is searched as soon as the panel opens.
  useEffect(() => {
    if (initial.trim().length >= 2) schedule(initial.trim())
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, [])

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-control border border-separator p-2.5">
      <div className="flex gap-1.5">
        <input
          aria-label="Search USDA foods"
          value={q}
          autoFocus
          onChange={(e) => search(e.target.value)}
          onKeyDown={(e) => {
            // Enter here picks nothing and must not submit the recipe form.
            if (e.key === 'Enter') e.preventDefault()
            if (e.key === 'Escape') {
              e.stopPropagation()
              onCancel()
            }
          }}
          placeholder="Search USDA foods"
          className={cn(fieldClass, 'flex-1')}
        />
        <ActionButton size="sm" onClick={onCancel} className="self-center">
          Cancel
        </ActionButton>
      </div>

      {state === 'loading' && <p className="text-footnote text-secondary-label">Searching…</p>}
      {error && <p className="text-footnote text-red-text">{error}</p>}
      {state === 'done' && !error && foods.length === 0 && (
        <p className="text-footnote text-secondary-label">No USDA food matches. Try a plainer name, like &quot;chicken thigh&quot;.</p>
      )}

      {foods.length > 0 && (
        <ul className="flex flex-col" aria-label="USDA matches">
          {foods.map((f) => (
            <li key={f.fdcId}>
              <button
                type="button"
                onClick={() => onPick(f)}
                className="flex min-h-11 w-full flex-col items-start gap-0.5 rounded-control px-2 py-1.5 text-left hover:bg-fill-4 focus-visible:bg-fill-4"
              >
                <span className="text-subheadline text-label">{f.description}</span>
                <span className="num text-caption-1 text-secondary-label">
                  per 100 g: {Math.round(f.per100.kcal)} kcal, {f.per100.protein}g protein, {f.per100.carbs}g carbs, {f.per100.fat}g fat
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
