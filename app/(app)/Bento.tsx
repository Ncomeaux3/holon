'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useLongPress } from '@/components/pos/gestures'
import { ActionButton, useToast } from '@/components/pos'
import { BASE, SIZE, VARIANT } from '@/components/pos/button-classes'
import type { Settings } from '@/core/settings'
import { arrange } from '@/core/dashboard-layout'
import { saveDashboardLayout } from './shell-actions'

// The dashboard grid, in the order the owner likes it.
//
// The tiles themselves are server rendered and handed over as nodes: this
// component only decides what order they go in and which are hidden, which is
// the whole of what arranging is. Nothing about a tile's contents reaches the
// client because of it. The layout is one setting for every device (v1.1
// Phase 5); it arrives as a prop and goes back through a server action.

export type Tile = { id: string; node: ReactNode }

export type Layout = Settings['dashboard_layout']

/**
 * The bento.
 *
 * Auto-fit at 300px is the artboard's: three columns at 1440, two at 1024,
 * one on a phone. Rows are `auto` rather than the artboard's 200px minimum so
 * a row is as tall as its tallest tile (v1.1 Phase 5); the tiles in a row
 * still fill it, because a ragged bottom edge read worse than a short tile
 * (ui-verifier, 2026-09-15). `content-start` keeps the rows packed at the top.
 *
 * Arrange mode is `?arrange=1` rather than component state, so the button that
 * turns it on can live up in the header where the design puts it without a
 * context to carry the flag across the page.
 */
export function Bento({ tiles, layout: saved }: { tiles: Tile[]; layout: Layout }) {
  const arranging = useSearchParams().get('arrange') === '1'
  const router = useRouter()
  // PosPhone's way in: hold a tile and the page enters the same arrange mode
  // the header link opens. Touch and pen only; see components/pos/gestures.
  // Arrange is desktop only (2026-09-13 decision), so a phone hold is a no-op.
  const press = useLongPress(() => {
    if (window.innerWidth < 768) return
    router.push('/?arrange=1')
  })

  // The saved layout is the initial state; each change applies here at once
  // and is written back in a transition, so a move never waits on the server.
  const [layout, setLayout] = useState<Layout>(saved)
  const [, start] = useTransition()
  const [dragging, setDragging] = useState<string | null>(null)
  const toast = useToast()

  const save = (next: Layout) => {
    const prev = layout
    setLayout(next)
    start(async () => {
      const result = await saveDashboardLayout(next)
      if (!result.ok) {
        setLayout(prev)
        toast(result.error)
      }
    })
  }
  const hidden = layout?.hidden ?? []
  const { sorted, shown, hidden: hiddenTiles } = arrange(
    tiles.map((t) => t.id),
    layout,
  )

  // Moves are over the visible tiles, so ‹ on the tile after a hidden one
  // swaps with what the owner sees, not with the hidden one.
  const reorder = (next: string[]) => save({ order: [...next, ...hiddenTiles], hidden })

  const move = (id: string, by: number) => {
    const from = shown.indexOf(id)
    const to = Math.max(0, Math.min(shown.length - 1, from + by))
    if (from === to) return
    const next = [...shown]
    next.splice(to, 0, ...next.splice(from, 1))
    reorder(next)
  }

  const drop = (onto: string) => {
    if (!dragging || dragging === onto) return
    const next = shown.filter((id) => id !== dragging)
    next.splice(shown.indexOf(onto), 0, dragging)
    reorder(next)
    setDragging(null)
  }

  const hide = (id: string) => save({ order: sorted, hidden: [...hidden, id] })
  const show = (id: string) => save({ order: sorted, hidden: hidden.filter((h) => h !== id) })

  return (
    // The artboard: the grid sits 22px under the headline block, and in
    // arrange mode the banner takes 18px of that and the grid 22px more.
    <div className="mt-[22px]">
      {arranging && (
        <div className="-mt-1 mb-[22px] flex flex-wrap items-center justify-between gap-3 rounded-card border border-dashed border-accent px-3.5 py-2.5 text-footnote text-label">
          <span>
            Arrange mode: <span className="max-md:hidden">drag tiles, or </span>use ‹ › and Hide on
            each. The layout is saved for every device.
          </span>
          <ActionButton variant="quiet" size="sm" onClick={() => save(null)}>
            Reset to default
          </ActionButton>
        </div>
      )}

      <div
        data-testid="dashboard-bento"
        className="grid grid-cols-1 content-start gap-3 md:grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] md:gap-3.5"
      >
        {shown.map((id) => {
          const tile = tiles.find((t) => t.id === id)
          if (!tile) return null

          return (
            <div
              key={id}
              {...(arranging ? {} : press)}
              draggable={arranging}
              onDragStart={() => setDragging(id)}
              onDragOver={(e) => arranging && e.preventDefault()}
              onDrop={() => drop(id)}
              className={cn(
                'flex min-w-0 flex-col',
                arranging && 'cursor-grab',
                dragging === id && 'opacity-60',
              )}
            >
              {arranging && (
                <div className="flex items-center justify-between rounded-t-card border border-b-0 border-accent bg-grouped-2 px-2 py-1.5">
                  <ActionButton variant="quiet" size="sm" aria-label={`Move ${id} earlier`} onClick={() => move(id, -1)}>
                    ‹
                  </ActionButton>
                  <span className="text-footnote text-secondary-label">Drag</span>
                  <span className="flex items-center gap-1">
                    <ActionButton variant="quiet" size="sm" aria-label={`Hide ${id}`} onClick={() => hide(id)}>
                      Hide
                    </ActionButton>
                    <ActionButton variant="quiet" size="sm" aria-label={`Move ${id} later`} onClick={() => move(id, 1)}>
                      ›
                    </ActionButton>
                  </span>
                </div>
              )}
              {tile.node}
            </div>
          )
        })}
      </div>

      {/* Hidden tiles exist only here, in arrange mode, so a hidden tile is
        * always one press from coming back and never quietly lost. */}
      {arranging && hiddenTiles.length > 0 && (
        <div
          data-testid="dashboard-hidden"
          className="mt-[22px] flex flex-wrap items-center gap-2 text-footnote text-secondary-label"
        >
          <span>Hidden</span>
          {hiddenTiles.map((id) => (
            <ActionButton key={id} variant="outline" size="sm" aria-label={`Show ${id}`} onClick={() => show(id)}>
              {id} · Show
            </ActionButton>
          ))}
        </div>
      )}
    </div>
  )
}

/** The header's Arrange toggle. A link, because the mode lives in the URL. */
export function ArrangeToggle() {
  const arranging = useSearchParams().get('arrange') === '1'

  return (
    <Link
      href={arranging ? '/' : '/?arrange=1'}
      className={cn(
        // The package's button, 44px at every width, Primary while arranging.
        // Arrange is desktop only (2026-09-13 decision).
        BASE,
        SIZE.md,
        arranging ? VARIANT.primary : VARIANT.normal,
        'hidden md:inline-flex',
      )}
    >
      {arranging ? 'Done' : 'Arrange'}
    </Link>
  )
}
