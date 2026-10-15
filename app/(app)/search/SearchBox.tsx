'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { ActionButton } from '@/components/pos'
import { cn } from '@/lib/utils'

/**
 * The box sits 18vh down on an empty search and rises to the top once there
 * is a query. It is a real form, so Enter works and the URL carries the
 * query, which makes a search linkable.
 */
export function SearchBox({ initial }: { initial: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const [value, setValue] = useState(initial)
  const has = initial.length > 0

  function submit(next: string) {
    const q = next.trim()
    const search = new URLSearchParams(params.toString())
    if (q) search.set('q', q)
    else search.delete('q')
    // A new query invalidates the module filter and the open row.
    if (q !== initial) {
      search.delete('module')
      search.delete('open')
    }
    router.push(`/search?${search.toString()}`)
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit(value)
      }}
      className={cn('transition-[padding] duration-300', has ? 'pt-6' : 'pt-[18vh]')}
    >
      <div
        className={cn(
          'flex h-[60px] items-center rounded-card border bg-grouped-2 transition-colors duration-150',
          'focus-within:outline-2 focus-within:outline-(--focus-ring)',
          has ? 'border-accent' : 'border-separator',
        )}
      >
        <span aria-hidden className="num pl-[18px] pr-3.5 text-subheadline text-secondary-label">
          &gt;
        </span>
        <input
          autoFocus
          name="q"
          aria-label="Search everything"
          placeholder="What are you looking for?"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-body text-label outline-none placeholder:text-placeholder"
        />
        {value && (
          <ActionButton
            variant="quiet"
            onClick={() => {
              setValue('')
              submit('')
            }}
            className="mr-2 shrink-0"
          >
            Clear
          </ActionButton>
        )}
      </div>
    </form>
  )
}
