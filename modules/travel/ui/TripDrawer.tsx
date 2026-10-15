'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState, useTransition } from 'react'
import {
  ActionButton,
  Alert,
  Card,
  ConfirmButton,
  EmptyState,
  Eyebrow,
  Field,
  MetricStrip,
  MetricTile,
  Overlay,
  SkillPicker,
  StatusChip,
  TabBar,
  fieldClass,
  useFormErrors,
  useToast,
  type ChipTone,
} from '@/components/pos'
import { HIT } from '@/components/pos/button-classes'
import { parseNumber } from '@/core/numbers'
import { cn } from '@/lib/utils'
import { actualFor, parseCategory, remaining } from '../budget'
import type { Hit } from '../geocode'
import {
  decideItem,
  deleteBudgetLine,
  deleteTrip,
  mergeTrip,
  saveBudgetLine,
  savePacking,
  saveTrip,
  type ActionResult,
} from './actions'
import { blankRow, rowsFor, toDestinations, type Row } from './rows'
import { Itinerary } from './Itinerary'
import { dateRange, money, nights, type Trip, type TravelData } from './Travel'

// The trip drawer, as POS Travel.dc.html draws it: the trip's name and line,
// Edit details and a status pill, then Itinerary, Budget, Packing and Inbox.
// The same drawer in form mode is New trip, Add to wishlist and Edit details.
// Every row edits in place; nothing here is a modal on a modal.

type Tab = 'itin' | 'budget' | 'packing' | 'inbox'

const STATUS_TONE: Record<string, ChipTone> = {
  idea: 'quiet',
  planned: 'neutral',
  booked: 'brand',
  done: 'quiet',
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const at = (iso: string) => new Date(`${iso}T12:00:00`)
const shortDate = (iso: string) => `${MONTHS[at(iso).getMonth()]} ${at(iso).getDate()}`
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// The one field style at the drawer's inline density: a row edits in place.
// The footnote size is set as a property because holon-ui's tokens.css
// declares `.text-body` after Tailwind's variants, so `md:text-footnote`
// loses to fieldClass's body size. ponytail: drop for `md:text-footnote` once
// holon-ui orders its type styles before the variants.
const inlineInput = cn(fieldClass, 'px-2 py-1 md:[font-size:var(--type-footnote)] md:[line-height:var(--type-footnote-leading)]')

export function TripDrawer({
  trip,
  mode,
  data,
  tab: tabParam,
  onTab,
  onClose,
}: {
  trip: Trip | null
  /** New trip or new wish when no trip is open. */
  mode: 'trip' | 'wish' | null
  data: TravelData
  /** The open tab, from the URL so a reload and a link keep it. */
  tab: string | null
  onTab: (tab: Tab) => void
  onClose: () => void
}) {
  const tab: Tab = tabParam === 'budget' || tabParam === 'packing' || tabParam === 'inbox' ? tabParam : 'itin'
  const setTab = onTab
  const [editing, setEditing] = useState(false)
  // The trip picked to merge into. Picking one asks through an Alert, and
  // Cancel puts the select back; leaving it showing a trip that was not merged
  // reads as though it had been.
  const [mergeInto, setMergeInto] = useState('')
  const [, start] = useTransition()
  const toast = useToast()
  const run = (action: () => Promise<ActionResult>, ok?: string, then?: () => void) =>
    start(async () => {
      const result = await action()
      if (!result.ok) toast(result.error)
      else {
        if (ok) toast(ok)
        then?.()
      }
    })

  if (!trip || editing) {
    const formMode = editing && trip ? (trip.status === 'idea' ? 'wish' : 'trip') : (mode ?? 'trip')
    return (
      <TripForm
        trip={editing ? trip : null}
        destinations={
          editing && trip ? data.destinations.filter((d) => d.tripId === trip.id) : []
        }
        mode={formMode}
        onClose={editing ? () => setEditing(false) : onClose}
        run={run}
      />
    )
  }

  const items = data.itinerary.filter((i) => i.tripId === trip.id)
  // Ideas sit on their day beside what is booked; pending waits in the Inbox
  // and a dismissed email is never drawn.
  const planned = items.filter((i) => i.status === 'confirmed' || i.status === 'idea')
  // Everything but this trip, by name, because the select is read rather than
  // scanned for a date.
  const others = data.trips
    .filter((t) => t.id !== trip.id)
    .sort((a, b) => a.name.localeCompare(b.name))
  const mergeTarget = mergeInto ? others.find((t) => t.id === mergeInto) : undefined
  const pending = items.filter((i) => i.status === 'pending')
  const packing = data.packing.filter((p) => p.tripId === trip.id)
  const lines = data.budgetLines.filter((l) => l.tripId === trip.id)
  const tabs: { value: Tab; label: string; count?: number; countTone?: 'warn' }[] = [
    { value: 'itin', label: 'Itinerary' },
    { value: 'budget', label: 'Budget' },
    { value: 'packing', label: 'Packing' },
    { value: 'inbox', label: 'Inbox', count: pending.length || undefined, countTone: 'warn' },
  ]

  return (
    <Overlay
      open
      wide
      onClose={onClose}
      eyebrow={`Travel / ${trip.name}`}
      title={
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-title-2">{trip.name}</span>
            <span className="mt-1.5 block text-footnote font-normal tracking-normal text-secondary-label">
              {trip.destination ? `${trip.destination} · ` : ''}
              {dateRange(trip, data.todayIso)} · {nights(trip)} nights · {trip.travellers}{' '}
              {trip.travellers === 1 ? 'traveler' : 'travelers'}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5 font-normal tracking-normal">
            <ActionButton size="sm" onClick={() => setEditing(true)}>
              Edit details
            </ActionButton>
            <StatusChip tone={STATUS_TONE[trip.status] ?? 'neutral'}>{cap(trip.status)}</StatusChip>
          </span>
        </span>
      }
      footer={
        <>
          <span className="text-caption-1 text-secondary-label">
            {data.checkinTrigger ? (
              <>
                Check-in reminders: <span className="text-label">{data.checkinTrigger.toLowerCase()}</span> ·{' '}
                <Link href="/notifications" className={cn(HIT, 'inline-block hover:text-label')}>
                  Notifications
                </Link>
              </>
            ) : (
              'Check-in reminders are off in Notifications.'
            )}
          </span>
          {/* Four trips to the same country were four trips because a trip
            * held one destination. Merging folds one into another as a
            * destination rather than deleting it, so nothing that was planned
            * under it is lost. */}
          {others.length > 0 && (
            <select
              value={mergeInto}
              aria-label="Merge into"
              onChange={(e) => setMergeInto(e.target.value)}
              className={cn(fieldClass, 'w-auto py-1.5')}
            >
              <option value="">Merge into…</option>
              {others.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <Alert
            open={mergeTarget !== undefined}
            onClose={() => setMergeInto('')}
            title="Merge this trip?"
            message={
              mergeTarget &&
              `Its destinations, itinerary, packing and budget move to ${mergeTarget.name}, and ${trip.name} is deleted.`
            }
            actions={[
              { label: 'Cancel', role: 'cancel' },
              { label: 'Merge', role: 'destructive', onPress: () => run(() => mergeTrip(trip.id, mergeInto), 'Trips merged', onClose) },
            ]}
          />
          <ConfirmButton
            confirmLabel="Delete trip"
            title="Delete this trip?"
            message={`${trip.name} and its itinerary, packing and budget are deleted.`}
            onConfirm={() => run(() => deleteTrip(trip.id), 'Trip deleted', onClose)}
          >
            Delete trip
          </ConfirmButton>
        </>
      }
    >
      <TabBar label="Trip" value={tab} onChange={setTab} tabs={tabs} />

      <div className="mt-[18px] flex flex-col gap-4">
        {tab === 'itin' && (
          <Itinerary trip={trip} items={planned} destinations={data.destinations.filter((d) => d.tripId === trip.id)} run={run} />
        )}
        {tab === 'budget' && <Budget trip={trip} items={items} lines={lines} run={run} />}
        {tab === 'packing' && <Packing trip={trip} packing={packing} run={run} />}
        {tab === 'inbox' && <Inbox pending={pending} run={run} />}
      </div>

      <div className="mt-5">
        <Eyebrow>Linked skills</Eyebrow>
        {trip.entityRef ? (
          <SkillPicker entityRef={trip.entityRef} links={trip.skills} skills={data.skills} className="mt-2" />
        ) : (
          <p className="mt-2 text-footnote text-secondary-label">Nothing matched yet.</p>
        )}
      </div>
    </Overlay>
  )
}

type Run = (action: () => Promise<ActionResult>, ok?: string, then?: () => void) => void

const DEFAULT_LINES = ['Flights', 'Lodging', 'Food', 'Transit', 'Activities']

function Budget({
  trip,
  items,
  lines: allLines,
  run,
}: {
  trip: Trip
  items: TravelData['itinerary']
  lines: TravelData['budgetLines']
  run: Run
}) {
  const [draft, setDraft] = useState('')
  // A line leaves the moment ✕ is pressed, same shape as Inbox.tsx's act():
  // optimistic, reverted with a toast on failure.
  const [gone, setGone] = useState<string[]>([])
  const lines = allLines.filter((l) => !gone.includes(l.id))
  const removeLine = (l: TravelData['budgetLines'][number]) => {
    setGone((g) => [...g, l.id])
    run(async () => {
      const result = await deleteBudgetLine(trip.id, l.category)
      if (!result.ok) setGone((g) => g.filter((x) => x !== l.id))
      return result
    }, 'Removed')
  }
  const shaped = lines.map((l) => ({ ...l, planned_cents: l.plannedCents, actual_override_cents: l.actualOverrideCents }))
  const itemShapes = items.map((i) => ({ kind: i.kind, status: i.status, amount_cents: i.amountCents }))
  const left = remaining(trip.budgetCents, trip.plannedCents, trip.spentCents)
  const dollars = (cents: number) => String(Math.round(cents / 100))

  const add = () => {
    const parsed = parseCategory(draft)
    if (!parsed) return
    run(
      () => saveBudgetLine({ trip_id: trip.id, category: parsed.category, planned_cents: Math.round(parsed.dollars * 100) }),
      'Added',
      () => setDraft(''),
    )
  }

  return (
    <>
      <MetricStrip className="grid-cols-2 sm:grid-cols-4">
        <MetricTile
          size="sm"
          label="Budget"
          value={
            <input
              inputMode="decimal"
              defaultValue={dollars(trip.budgetCents)}
              aria-label="Budget in dollars"
              onBlur={(e) => {
                const typed = parseNumber(e.target.value)
                const next = typed === null ? null : Math.round(typed * 100)
                if (next !== null && next !== trip.budgetCents) run(() => saveTrip({ id: trip.id, budget_cents: next }), 'Budget saved')
              }}
              className="num w-full border-0 border-b border-separator bg-transparent font-semibold text-label outline-none focus-visible:border-accent"
            />
          }
        />
        <MetricTile size="sm" label="Planned" value={money(trip.plannedCents)} valueTone={trip.plannedCents > trip.budgetCents ? 'bad' : undefined} />
        <MetricTile size="sm" label="Spent" value={money(trip.spentCents)} valueTone={trip.spentCents > trip.budgetCents ? 'bad' : undefined} />
        <MetricTile size="sm" label="Remaining" value={money(left)} valueTone={left < 0 ? 'bad' : undefined} />
      </MetricStrip>
      <p className="-mt-2 text-footnote text-secondary-label">
        Planned is the confirmed itinerary, spent the transactions tagged to this trip in Finance.
        Remaining is the budget less the larger of the two.
      </p>

      <div className="label grid grid-cols-[1fr_90px_90px_20px] gap-2.5 text-secondary-label">
        <span>Category</span>
        <span className="text-right">Actual</span>
        <span className="text-right">Planned</span>
        <span />
      </div>
      <div className="-mt-3 flex flex-col">
        {shaped.map((l) => {
          const actual = actualFor(l, itemShapes)
          const pct = l.planned_cents > 0 ? Math.min(100, (actual / l.planned_cents) * 100) : 0
          return (
            <div key={l.id} className="border-b border-separator py-2">
              <div className="grid grid-cols-[1fr_90px_90px_20px] items-center gap-2.5 text-footnote">
                <span className="text-label">{l.category}</span>
                <input
                  inputMode="decimal"
                  key={`a-${l.id}-${l.actual_override_cents}`}
                  defaultValue={dollars(actual)}
                  aria-label={`${l.category} actual in dollars`}
                  title={l.actual_override_cents === null ? 'Summed from the confirmed itinerary; type to override' : 'Typed over; clear to sum again'}
                  onBlur={(e) => {
                    const raw = e.target.value.trim()
                    const typed = parseNumber(raw)
                    // Empty clears the override; anything else that is not a number is ignored.
                    if (raw !== '' && typed === null) return
                    const next = typed === null ? null : Math.round(typed * 100)
                    if (next === l.actual_override_cents) return
                    if (next !== null && next === actual && l.actual_override_cents === null) return
                    run(() => saveBudgetLine({ trip_id: trip.id, category: l.category, actual_override_cents: next }), 'Saved')
                  }}
                  className={cn(inlineInput, 'num text-right', l.actual_override_cents === null && 'text-label/70')}
                />
                <input
                  inputMode="decimal"
                  key={`p-${l.id}-${l.planned_cents}`}
                  defaultValue={dollars(l.planned_cents)}
                  aria-label={`${l.category} planned in dollars`}
                  onBlur={(e) => {
                    const typed = parseNumber(e.target.value)
                    const next = typed === null ? null : Math.round(typed * 100)
                    if (next !== null && next !== l.planned_cents) run(() => saveBudgetLine({ trip_id: trip.id, category: l.category, planned_cents: next }), 'Saved')
                  }}
                  className={cn(inlineInput, 'num text-right')}
                />
                <ActionButton variant="danger" size="sm" aria-label={`Remove ${l.category}`} onClick={() => removeLine(l)} className="h-6 w-6 px-0 text-caption-1 sm:px-0">
                  ✕
                </ActionButton>
              </div>
              <div className="mt-1.5 h-[3px] bg-fill-3">
                <div className={cn('h-[3px]', actual > l.planned_cents && l.planned_cents > 0 ? 'bg-red' : 'bg-accent')} style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })}
        {shaped.length === 0 && (
          <button
            type="button"
            onClick={() =>
              run(async () => {
                for (const category of DEFAULT_LINES) {
                  const result = await saveBudgetLine({ trip_id: trip.id, category, planned_cents: 0 })
                  if (!result.ok) return result
                }
                return { ok: true }
              }, 'Five lines to fill in')
            }
            className="rounded-card border border-dashed border-gray-3 py-4 text-footnote text-secondary-label hover:text-label"
          >
            No lines yet. Start with flights, lodging, food, transit and activities.
          </button>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
        className="flex gap-1.5"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Add a budget category"
          placeholder="Add a category, e.g. Gifts 200"
          className={cn(fieldClass, 'min-w-0 flex-1 py-1.5')}
        />
        <ActionButton type="submit" size="sm" className="self-center">
          Add
        </ActionButton>
      </form>
      <p className="text-caption-1 text-secondary-label">
        Actuals are the trip&apos;s confirmed itinerary by kind; you can type over any number.
      </p>
    </>
  )
}

function Packing({ trip, packing: allPacking, run }: { trip: Trip; packing: TravelData['packing']; run: Run }) {
  const [draft, setDraft] = useState('')
  // The checkbox flips and a removed row leaves immediately, reverted with a
  // toast on failure, same shape as Inbox.tsx's act().
  const [packedOverride, setPackedOverride] = useState<Record<string, boolean>>({})
  const [gone, setGone] = useState<string[]>([])
  const packing = allPacking
    .filter((p) => !gone.includes(p.id))
    .map((p) => ({ ...p, packed: packedOverride[p.id] ?? p.packed }))
  const toggle = (p: (typeof packing)[number]) => {
    const next = !p.packed
    setPackedOverride((o) => ({ ...o, [p.id]: next }))
    run(async () => {
      const result = await savePacking({ id: p.id, packed: next })
      if (!result.ok) setPackedOverride((o) => ({ ...o, [p.id]: !next }))
      return result
    })
  }
  const remove = (p: (typeof packing)[number]) => {
    setGone((g) => [...g, p.id])
    run(async () => {
      const result = await savePacking({ id: p.id, remove: true })
      if (!result.ok) setGone((g) => g.filter((x) => x !== p.id))
      return result
    }, 'Removed')
  }
  const packed = packing.filter((p) => p.packed).length
  return (
    <>
      <div className="flex items-baseline justify-between">
        <Eyebrow>Packing list</Eyebrow>
        <span className="num text-footnote text-secondary-label">
          {packed} / {packing.length} packed
        </span>
      </div>
      <div className="-mt-2 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-5">
        {packing.map((p) => (
          <div key={p.id} className="flex items-center gap-1.5 border-b border-separator">
            <button
              type="button"
              role="checkbox"
              aria-checked={p.packed}
              onClick={() => toggle(p)}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left"
            >
              <span aria-hidden className={cn('grid size-3.5 shrink-0 place-items-center border rounded-full', p.packed ? 'border-accent bg-accent' : 'border-secondary-label')}>
                {p.packed && <span className="size-1.5 rounded-full bg-grouped-2" />}
              </span>
              <span className={cn('truncate text-subheadline', p.packed ? 'text-secondary-label line-through' : 'text-label')}>{p.label}</span>
            </button>
            <ActionButton variant="danger" size="sm" aria-label={`Remove ${p.label}`} onClick={() => remove(p)} className="h-6 w-6 px-0 text-caption-1 sm:px-0">
              ✕
            </ActionButton>
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const label = draft.trim()
          if (label) run(() => savePacking({ trip_id: trip.id, label }), 'Added', () => setDraft(''))
        }}
        className="flex gap-1.5"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Add a packing item"
          placeholder="Add an item"
          className={cn(fieldClass, 'min-w-0 flex-1 py-1.5')}
        />
        <ActionButton type="submit" size="sm" className="self-center">
          Add
        </ActionButton>
      </form>
    </>
  )
}

function Inbox({ pending: allPending, run }: { pending: TravelData['itinerary']; run: Run }) {
  // A parsed booking leaves the inbox the moment Add or Dismiss is pressed,
  // same shape as Inbox.tsx's act(): optimistic, reverted with a toast on
  // failure.
  const [gone, setGone] = useState<string[]>([])
  const pending = allPending.filter((m) => !gone.includes(m.id))
  const decide = (id: string, accept: boolean) => {
    setGone((g) => [...g, id])
    run(async () => {
      const result = await decideItem(id, accept)
      if (!result.ok) setGone((g) => g.filter((x) => x !== id))
      return result
    }, accept ? 'Added to the trip' : 'Dismissed')
  }
  return (
    <>
      <p className="text-footnote text-secondary-label">
        Confirmations an agent parsed wait here as itinerary items. Approve to add; nothing is
        added without you.
      </p>
      {pending.map((m) => (
        <Card key={m.id} className="flex flex-col gap-2 px-3.5 py-3">
          <div className="flex justify-between gap-2.5">
            <span className="min-w-0 truncate text-footnote text-secondary-label">Parsed booking · {m.kind}</span>
            <StatusChip tone="warn">Pending</StatusChip>
          </div>
          <div className="text-subheadline text-label">{m.title}</div>
          <div className="text-footnote text-secondary-label">
            {[m.occursOn ? shortDate(m.occursOn) : '', m.detail, m.amountCents > 0 ? money(m.amountCents) : '']
              .filter(Boolean)
              .join(' · ')}
            {m.confidence !== null ? ` · confidence ${Math.round(m.confidence * 100)}%` : ''}
          </div>
          <div className="flex gap-1.5">
            <ActionButton size="sm" variant="accent" onClick={() => decide(m.id, true)}>
              Add
            </ActionButton>
            <ActionButton size="sm" onClick={() => decide(m.id, false)}>
              Dismiss
            </ActionButton>
          </div>
        </Card>
      ))}
      {pending.length === 0 && <EmptyState headline="Inbox is clear">A parsed confirmation waits here until you add or dismiss it.</EmptyState>}
    </>
  )
}

/**
 * One destination: where, its coordinates, and when you are there.
 *
 * A component per row rather than one bag of state in the form, because the
 * suggestion list is per field: it is debounced, it arrives late, and a slow
 * answer for row one must not land in row three's datalist. Owning it here
 * makes each row exactly the single-destination form this used to be.
 */
function DestinationFields({
  row,
  index,
  canRemove,
  showDates,
  onChange,
  onRemove,
}: {
  row: Row
  index: number
  canRemove: boolean
  showDates: boolean
  /** A patch, not a whole row: see the handler in TripForm. */
  onChange: (patch: Partial<Row>) => void
  onRemove: () => void
}) {
  const [hits, setHits] = useState<Hit[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestQuery = useRef('')
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  const listId = `destination-hits-${row.key}`
  const field = cn(fieldClass, 'w-full')

  // Picking a suggestion exactly fills lat and lon too, but a typed number
  // still wins, because Lat and Lon stay plain inputs.
  const onName = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    const picked = hits.find((h) => h.label === value)
    onChange({
      name: picked ? picked.label.split(',')[0] : value,
      ...(picked ? { lat: String(picked.lat), lon: String(picked.lon) } : {}),
    })
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (picked) {
      // The field now holds "Paris" and the list still held "Paris, France",
      // so the browser matched it and popped the list back up over the pick.
      latestQuery.current = value
      setHits([])
      return
    }
    debounceRef.current = setTimeout(() => {
      // A slow answer to an earlier query must not replace a newer list.
      // A GET, not a server action: actions queue, and a search stuck on the
      // geocoder would hold the trip's own save behind it.
      fetch(`/api/travel/places?q=${encodeURIComponent(value)}`)
        .then((res) => (res.ok ? (res.json() as Promise<Hit[]>) : []))
        .catch(() => [])
        .then((found) => {
          if (value === latestQuery.current) setHits(found)
        })
    }, 300)
    latestQuery.current = value
  }

  return (
    <div data-testid="destination-row" className="flex flex-col gap-3 border-l border-separator pl-3">
      <div className="grid grid-cols-[1fr_96px_96px] gap-3">
        <label className="flex flex-col gap-1.5">
          <Eyebrow>{index === 0 ? 'Destination' : `Destination ${index + 1}`}</Eyebrow>
          <input
            value={row.name}
            onChange={onName}
            onKeyDown={(e) => {
              // Enter with the list open takes its first place rather than
              // submitting a trip that has a name and no pin.
              if (e.key === 'Enter' && hits.length > 0 && !row.lat) {
                e.preventDefault()
                onName({ target: { value: hits[0].label } } as React.ChangeEvent<HTMLInputElement>)
              }
            }}
            placeholder="City, country"
            list={listId}
            className={field}
          />
          <datalist id={listId}>
            {hits.map((h) => (
              <option key={`${h.label} ${h.lat} ${h.lon}`} value={h.label} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Lat</Eyebrow>
          <input
            value={row.lat}
            onChange={(e) => onChange({ lat: e.target.value })}
            placeholder="35.69"
            className={cn(field, 'num')}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <Eyebrow>Lon</Eyebrow>
          <input
            value={row.lon}
            onChange={(e) => onChange({ lon: e.target.value })}
            placeholder="139.69"
            className={cn(field, 'num')}
          />
        </label>
      </div>
      {showDates && (
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <Eyebrow>Arrive</Eyebrow>
            <input
              type="date"
              value={row.start}
              onChange={(e) => onChange({ start: e.target.value })}
              className={cn(field, 'num')}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <Eyebrow>Leave</Eyebrow>
            <input
              type="date"
              value={row.end}
              onChange={(e) => onChange({ end: e.target.value })}
              className={cn(field, 'num')}
            />
          </label>
          {canRemove && (
            <ActionButton
              variant="danger"
              onClick={onRemove}
              aria-label={`Remove ${row.name || `destination ${index + 1}`}`}
              className="min-h-11"
            >
              Remove
            </ActionButton>
          )}
        </div>
      )}
      {!showDates && canRemove && (
        <ActionButton
          variant="danger"
          size="sm"
          onClick={onRemove}
          aria-label={`Remove ${row.name || `destination ${index + 1}`}`}
          className="self-start"
        >
          Remove
        </ActionButton>
      )}
    </div>
  )
}

function TripForm({
  trip,
  destinations,
  mode,
  onClose,
  run,
}: {
  trip: Trip | null
  /** This trip's destinations, so the form opens on what it already has. */
  destinations: TravelData['destinations']
  mode: 'trip' | 'wish'
  onClose: () => void
  run: Run
}) {
  const initial = {
    name: trip?.name ?? '',
    budget: trip ? String(Math.round(trip.budgetCents / 100)) : '',
    travellers: trip ? String(trip.travellers) : '2',
    notes: trip?.notes ?? '',
  }
  const [f, setF] = useState(initial)
  const set = (key: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [key]: e.target.value }))

  // The destination list. Initialised once, from the trip's rows or, for a
  // trip that predates them, from its own place; never from nothing, or the
  // first save would wipe what the trip already said.
  const [rows, setRows] = useState<Row[]>(() => rowsFor(trip, destinations))
  const [initialRows] = useState(rows)
  const title = trip ? 'Edit details' : mode === 'wish' ? 'Add to wishlist' : 'New trip'

  // The wishlist is one place you would like to go, not an itinerary, so it
  // keeps a single row and no dates.
  const many = mode === 'trip'
  const nameLabel = mode === 'wish' ? 'Place' : 'Trip'
  const dirty =
    (Object.keys(initial) as (keyof typeof initial)[]).some((k) => f[k] !== initial[k]) ||
    JSON.stringify(rows) !== JSON.stringify(initialRows)
  const formId = useId()
  const { errors, ref: formRef, submit } = useFormErrors(() => ({
    name: f.name.trim() ? undefined : `${nameLabel} is required`,
    budget: f.budget.trim() && parseNumber(f.budget) === null ? 'Budget must be a number' : undefined,
    travellers: f.travellers.trim() && parseNumber(f.travellers) === null ? 'Travelers must be a number' : undefined,
  }))

  const save = () => {
    if (!submit()) return
    run(
      () =>
        saveTrip({
          id: trip?.id,
          name: f.name.trim(),
          notes: f.notes,
          // The trip's own destination, lat, lon and dates are not sent:
          // write_trip derives them from this set, and sending both would put
          // two answers in one call.
          destinations: toDestinations(rows),
          ...(many
            ? {
                budget_cents: Math.round((Number(f.budget) || 0) * 100),
                travellers: Math.max(1, Number(f.travellers) || 1),
                status: trip ? undefined : ('planned' as const),
              }
            : { status: trip ? undefined : ('idea' as const) }),
        }),
      trip ? 'Saved' : mode === 'wish' ? 'Added to the wishlist' : 'Trip created',
      onClose,
    )
  }
  const field = cn(fieldClass, 'w-full')

  return (
    <Overlay
      open
      wide
      onClose={onClose}
      dirty={dirty}
      eyebrow={`Travel / ${title}`}
      title={title}
      footer={
        <>
          <div className="flex flex-col items-start gap-1">
            <ActionButton variant="quiet" onClick={onClose}>
              Cancel
            </ActionButton>
            <span className="text-caption-1 text-secondary-label">Location search by Open-Meteo and GeoNames</span>
          </div>
          <ActionButton variant="solid" size="lg" type="submit" form={formId}>
            {trip ? 'Save' : mode === 'wish' ? 'Add' : 'Create'} <span aria-hidden="true">&rarr;</span>
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
          save()
        }}
      >
        <Field label={nameLabel} required error={errors.name}>
          <input value={f.name} onChange={set('name')} placeholder="e.g. Taipei · November" className={field} />
        </Field>

        {rows.map((row, i) => (
          <DestinationFields
            key={row.key}
            row={row}
            index={i}
            canRemove={rows.length > 1}
            showDates={many}
            // The patch is merged into the row as it stands in state, not into
            // the one this render closed over. Two fields changed faster than a
            // re-render would otherwise have the second revert the first.
            onChange={(patch) => setRows((all) => all.map((r) => (r.key === row.key ? { ...r, ...patch } : r)))}
            onRemove={() => setRows((all) => all.filter((r) => r.key !== row.key))}
          />
        ))}

        {many && (
          <ActionButton
            variant="quiet"
            size="sm"
            onClick={() => setRows((all) => [...all, blankRow()])}
            className="self-start"
          >
            + Add destination
          </ActionButton>
        )}

        {many ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Budget" error={errors.budget}>
              <input value={f.budget} onChange={set('budget')} placeholder="$" className={cn(field, 'num')} />
            </Field>
            <Field label="Travelers" error={errors.travellers}>
              <input value={f.travellers} onChange={set('travellers')} className={cn(field, 'num')} />
            </Field>
          </div>
        ) : (
          <label className="flex flex-col gap-1.5">
            <Eyebrow>Why · when</Eyebrow>
            <input value={f.notes} onChange={set('notes')} placeholder="Cherry blossoms, late March" className={field} />
          </label>
        )}
        <p className="text-caption-1 text-secondary-label">
          The trip&apos;s dates are the span of its destinations. Coordinates place each pin on the globe;
          without them a destination is listed and not drawn.
        </p>
      </form>
    </Overlay>
  )
}
