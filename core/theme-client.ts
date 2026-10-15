'use client'

import { useSyncExternalStore } from 'react'
import type { Theme } from './theme'

// Theme and the sidebar width are display preferences with no owner beyond
// this browser (core/theme.ts, not httpOnly by design), so the toggle in
// Sidebar.tsx and ThemeSwitch.tsx writes the cookie and the DOM itself:
// no server action, no auth check, no page re-render between a tap and the
// screen changing. core/theme.ts keeps reading the same cookies for the very
// first paint, on the server, before any of this runs.

const YEAR_SECONDS = 60 * 60 * 24 * 365

function setPrefCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${YEAR_SECONDS}; samesite=lax`
}

/** Sets <html data-theme> and the cookie together, so every ThemeSwitch on
 * the page (the rail's and a band's) reflects the tap immediately. */
export function applyTheme(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
  setPrefCookie('pos_theme', theme)
}

export function setSidebarCookie(collapsed: boolean) {
  setPrefCookie('pos_sidebar', collapsed ? 'collapsed' : 'expanded')
}

function readTheme(): Theme {
  const value = document.documentElement.dataset.theme
  return value === 'light' || value === 'dark' ? value : 'system'
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

/** Follows <html data-theme>, so two ThemeSwitch instances on one page (the
 * rail and a wizard band) stay in step without lifting state up to a parent. */
export function useTheme(initial: Theme): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => initial)
}
