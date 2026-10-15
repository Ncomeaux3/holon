'use client'

import Link from 'next/link'
import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react'
import type { ActionResult } from '@/app/(app)/settings/skills/actions'
import { linkSkill, unlinkSkill } from '@/app/(app)/settings/skills/actions'
import { cn } from '@/lib/utils'
import { HIT } from './button-classes'
import { fieldClass } from './field'
import { useToast } from './Toast'

// The one skill picker, on every entity drawer. Chips are the links the
// classifier or the owner made; the x and the plus are the owner's. Imports
// only the action file and its siblings here: a client component that reached
// into a module would pull that module's server code into the bundle.

export type SkillLink = {
  id: string
  name: string
  confidence: number
  by: 'manual' | 'rule' | 'model'
}

type Patch = { op: 'add'; link: SkillLink } | { op: 'remove'; id: string }

const BADGE: Record<SkillLink['by'], [string, string]> = {
  manual: ['Manual', 'text-orange-text'],
  rule: ['Rules', 'text-green-text'],
  model: ['Model', 'text-secondary-label'],
}

export function SkillPicker({
  entityRef,
  links,
  skills,
  className,
}: {
  entityRef: string
  links: SkillLink[]
  /** Every skill in the tree, id and name. From getSkillNames() on the page. */
  skills: [string, string][]
  className?: string
}) {
  const [shown, apply] = useOptimistic(links, (state: SkillLink[], patch: Patch) =>
    patch.op === 'add'
      ? [...state.filter((l) => l.id !== patch.link.id), patch.link]
      : state.filter((l) => l.id !== patch.id),
  )
  const [adding, setAdding] = useState(false)
  const [, start] = useTransition()
  const toast = useToast()
  // Both actions unmount the control that had focus (the select, the x), so
  // focus goes back to the plus rather than falling to the body.
  const plus = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)
  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    plus.current?.focus()
  })

  const linked = new Set(shown.map((l) => l.id))
  const unlinked = skills.filter(([id]) => !linked.has(id))

  const run = (patch: Patch, action: () => Promise<ActionResult>) =>
    start(async () => {
      apply(patch)
      const result = await action()
      if (!result.ok) toast(result.error)
    })

  return (
    <div className={cn('flex flex-wrap items-center gap-x-2.5 gap-y-3', className)}>
      {shown.length === 0 && !adding && (
        <span className="text-footnote text-secondary-label">Nothing matched yet.</span>
      )}
      {shown.map((l) => (
        <span
          key={l.id}
          className="inline-flex items-center gap-1.5 border border-opaque-separator px-2 py-[3px] text-caption-1 text-label rounded-full"
        >
          <Link href={`/skills?skill=${encodeURIComponent(l.id)}`} className={cn(HIT, 'inline-block hover:text-accent')}>
            {l.name}
          </Link>
          <span className={cn('text-caption-1', BADGE[l.by][1])}>
            {BADGE[l.by][0]}
          </span>
          <button
            type="button"
            aria-label={`Unlink ${l.name}`}
            onClick={() => {
              plus.current?.focus()
              run({ op: 'remove', id: l.id }, () => unlinkSkill(entityRef, l.id))
            }}
            className={cn(HIT, 'min-h-6 min-w-6 text-secondary-label hover:text-red-text')}
          >
            ×
          </button>
        </span>
      ))}
      {adding ? (
        <select
          autoFocus
          aria-label="Skill"
          defaultValue=""
          onBlur={() => setAdding(false)}
          onChange={(e) => {
            const id = e.target.value
            const name = skills.find(([s]) => s === id)?.[1] ?? id
            refocus.current = true
            setAdding(false)
            if (id) {
              run({ op: 'add', link: { id, name, confidence: 1, by: 'manual' } }, () =>
                linkSkill(entityRef, id),
              )
            }
          }}
          className={cn(fieldClass, 'w-auto py-[3px] text-caption-1')}
        >
          <option value="">Pick a skill</option>
          {unlinked.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      ) : (
        <button
          ref={plus}
          type="button"
          aria-label="Link a skill"
          onClick={() => setAdding(true)}
          className={cn(HIT, 'min-h-6 border border-dashed border-opaque-separator px-2 py-[3px] text-caption-1 text-secondary-label hover:border-label hover:text-label rounded-full')}
        >
          +
        </button>
      )}
    </div>
  )
}
