import type { Settings } from './settings'

type Layout = Settings['dashboard_layout']

/**
 * The tiles in the owner's order, split into shown and hidden.
 *
 * The stored order names tiles that may no longer exist (a module gone, or
 * the four ids Holon phase 3 turned into sections), and cannot know about a
 * module installed since. Known ids first in their saved order, then
 * everything new in the order the server sent it; an unknown id is dropped
 * whether it was hidden or not, so it never reaches the Hidden tray.
 */
export function arrange(ids: string[], layout: Layout): { sorted: string[]; shown: string[]; hidden: string[] } {
  const order = layout?.order ?? null
  const hidden = layout?.hidden ?? []
  const sorted = order
    ? [...order.filter((id) => ids.includes(id)), ...ids.filter((id) => !order.includes(id))]
    : ids
  return {
    sorted,
    shown: sorted.filter((id) => !hidden.includes(id)),
    hidden: sorted.filter((id) => hidden.includes(id)),
  }
}
