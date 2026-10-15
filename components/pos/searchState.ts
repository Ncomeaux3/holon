'use client'

import { useRouter, useSearchParams, type ReadonlyURLSearchParams } from 'next/navigation'
import { useSyncExternalStore } from 'react'

// The search params as UI state: which tab, which drawer, which row is open.
//
// The screen changes on the next render and the router navigates behind it,
// queued in order with any server action so the data it brings is fresh. A
// drawer opens within a frame; the URL and the list follow when the fetch
// lands.

// What was asked for, and the router's params at the time. Once the router
// hands out a new object it has caught up and the override is spent. One
// store, not one per hook: the button that opens a sheet and the component
// that renders it are often not the same one.
let override: { search: URLSearchParams; over: ReadonlyURLSearchParams } | null = null
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const snapshot = () => override

export function useSearchState() {
  const params = useSearchParams()
  const router = useRouter()
  const pending = useSyncExternalStore(subscribe, snapshot, snapshot)
  const current = pending && pending.over === params ? pending.search : params

  /**
   * Merge `next` into the URL. A null value removes the key.
   *
   * `push` adds a history entry, so the phone's Back closes what was opened.
   * Use it for sheets and drawers; tabs, views and modes inside a drawer
   * replace, so Back leaves the page rather than walking through every
   * segment visited.
   *
   * `local` writes the URL through `window.history.replaceState` and asks
   * the router for nothing. Use it for a switch that only re-buckets rows
   * already on the page (a task view, a tab); a change that follows a
   * server write keeps the router so the data it brings is fresh. Next 16's
   * app router syncs `useSearchParams` from a native `replaceState` call.
   */
  const set = (next: Record<string, string | null>, options: { push?: boolean; local?: boolean } = {}) => {
    const search = new URLSearchParams(current.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value === null) search.delete(key)
      else search.set(key, value)
    }
    override = { search, over: params }
    for (const fn of listeners) fn()
    const query = search.toString()
    const url = query ? `?${query}` : '?'
    // ponytail: the URL follows one fetch behind the screen. Writing it at
    // once through the History API, even with the router's own state attached,
    // raced a server action about once in thirty runs under a slow network and
    // showed a deleted row again. Revisit if Next gives a history write that
    // does not restore.
    if (options.local) window.history.replaceState(null, '', url)
    else if (options.push) router.push(url, { scroll: false })
    else router.replace(url, { scroll: false })
  }

  return { params: current, set }
}
