'use client'

import { useRef, useState } from 'react'
import { ActionButton, Card, CHEVRON, Chip, Field, STRETCH, STRETCH_WRAP, fieldClass, useFormErrors, type ChipTone } from '@/components/pos'
import { cn } from '@/lib/utils'
import { guessKind, KINDS, placesFor, tripDays, type Kind } from '../itinerary'
import { deleteItem, itemFileUrl, saveItem, saveReservation, type ActionResult } from './actions'
import type { Trip, TravelData } from './Travel'

// The trip drawer's Itinerary tab: one section per day under the city it is
// in, the parsed add line, and a reservation form. Split out of TripDrawer in
// v1.2 phase 10a.

type Item = TravelData['itinerary'][number]
type Run = (action: () => Promise<ActionResult>, ok?: string, then?: () => void) => void

const KIND_TONE: Record<string, ChipTone> = {
  flight: 'brand',
  lodging: 'neutral',
  transit: 'quiet',
  activity: 'warn',
  food: 'warn',
  other: 'quiet',
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDate = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const field = cn(fieldClass, 'w-full')

/** "day 2 19:30 Dinner at Narisawa": which day, what time, what. */
export function parseItem(text: string): { day: number | null; time: string | null; title: string } | null {
  const t = text.trim()
  if (!t) return null
  const m = t.match(/^(?:day\s*(\d+)\s*)?(?:(\d{1,2}:\d{2})\s*)?(.+)$/i)
  if (!m) return { day: null, time: null, title: t }
  return { day: m[1] ? Number(m[1]) : null, time: m[2] ? m[2].padStart(5, '0') : null, title: m[3].trim() }
}

export function Itinerary({
  trip,
  items: allItems,
  destinations,
  run,
}: {
  trip: Trip
  /** Confirmed items and ideas; pending ones wait in the Inbox. */
  items: Item[]
  destinations: TravelData['destinations']
  run: Run
}) {
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [reserving, setReserving] = useState(false)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const addRef = useRef<HTMLInputElement>(null)
  // An item leaves the moment ✕ is pressed: optimistic, reverted with a toast
  // on failure.
  const [gone, setGone] = useState<string[]>([])
  const items = allItems.filter((i) => !gone.includes(i.id))
  const remove = (id: string) => {
    setGone((g) => [...g, id])
    run(async () => {
      const result = await deleteItem(id)
      if (!result.ok) setGone((g) => g.filter((x) => x !== id))
      return result
    }, 'Removed')
  }
  const days = tripDays(trip.startsOn, trip.endsOn)
  const undated = items.filter((i) => !i.occursOn || !days.includes(i.occursOn))
  const byTime = (a: Item, b: Item) => (a.occursAt ?? '').localeCompare(b.occursAt ?? '')

  const add = () => {
    const parsed = parseItem(draft)
    if (!parsed) return
    // A day the trip does not have lands in Undated, not quietly on day 1.
    const occursOn = parsed.day ? (days[parsed.day - 1] ?? null) : (days[0] ?? null)
    run(
      () => saveItem({ trip_id: trip.id, title: parsed.title, occurs_on: occursOn, occurs_at: parsed.time, kind: guessKind(parsed.title) }),
      'Added',
      () => setDraft(''),
    )
  }
  const addTo = (n: number) => {
    setDraft(`day ${n} `)
    addRef.current?.focus()
  }
  // Desktop drags a row onto another day; the phone uses the editor's Day.
  const drop = (day: string, e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(null)
    const id = e.dataTransfer.getData('text/plain')
    const it = items.find((i) => i.id === id)
    if (it && it.occursOn !== day) run(() => saveItem({ id, occurs_on: day }), `Moved to ${shortDate(day)}`)
  }

  const row = (it: Item) =>
    editingId === it.id ? (
      <ItemEditor key={it.id} item={it} days={days} onDone={() => setEditingId(null)} run={run} />
    ) : (
      <div
        key={it.id}
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/plain', it.id)}
        className={cn(STRETCH_WRAP, 'grid grid-cols-[44px_1fr_auto] items-center gap-2.5 border-b border-separator py-2')}
      >
        <span className="num text-footnote text-secondary-label">{it.occursAt ?? ''}</span>
        <button type="button" title="Edit" onClick={() => setEditingId(it.id)} className={cn(STRETCH, 'min-w-0 text-left')}>
          <span className={cn('block text-subheadline', it.status === 'idea' ? 'text-secondary-label' : 'text-label')}>{it.title}</span>
          {(it.place || it.provider || it.detail || it.confirmation) && (
            <span className="mt-0.5 block text-footnote text-secondary-label">
              {[it.place, it.provider, it.detail, it.confirmation ? `conf. ${it.confirmation}` : ''].filter(Boolean).join(' · ')}
            </span>
          )}
        </button>
        <span className="relative z-10 flex items-center gap-2">
          {it.status === 'idea' && <Chip tone="quiet">Idea</Chip>}
          <Chip tone={KIND_TONE[it.kind] ?? 'quiet'}>{cap(it.kind)}</Chip>
          {it.hasFile && (
            <ActionButton
              size="sm"
              aria-label={`Open the file for ${it.title}`}
              onClick={async () => {
                // Opened before the await, or Safari treats the tab as a popup.
                const tab = window.open('', '_blank')
                const result = await itemFileUrl(it.id)
                if (result.ok && tab) tab.location.href = result.url
                else tab?.close()
              }}
            >
              File
            </ActionButton>
          )}
          <ActionButton variant="danger" size="sm" aria-label={`Remove ${it.title}`} onClick={() => remove(it.id)} className="h-6 w-6 px-0 text-caption-1 sm:px-0">
            ✕
          </ActionButton>
          <span aria-hidden="true" className={CHEVRON}>
            &rsaquo;
          </span>
        </span>
      </div>
    )

  return (
    <>
      {days.map((day, i) => {
        const today = items.filter((it) => it.occursOn === day).sort(byTime)
        // A trip from before destinations had rows keeps its place on itself.
        const places = destinations.length === 0 && trip.destination ? [trip.destination] : placesFor(day, destinations)
        return (
          <section
            key={day}
            aria-label={`Day ${i + 1}`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(day)
            }}
            onDragLeave={() => setDragOver((d) => (d === day ? null : d))}
            onDrop={(e) => drop(day, e)}
            className={cn('rounded-control', dragOver === day && 'bg-fill-3')}
          >
            <div className="flex items-center justify-between gap-2 border-b border-separator pb-1.5">
              <span className="min-w-0 truncate">
                <span className="text-subheadline font-semibold text-label">Day {i + 1}</span>
                {places.length > 0 && <span className="text-subheadline text-secondary-label"> · {places.join(' → ')}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="num text-footnote text-secondary-label">{shortDate(day)}</span>
                <ActionButton size="sm" variant="quiet" aria-label={`Add to day ${i + 1}`} onClick={() => addTo(i + 1)} className="h-6 w-6 px-0 sm:px-0">
                  +
                </ActionButton>
              </span>
            </div>
            {today.length === 0 ? <span className="block py-2 text-footnote text-secondary-label">Free day</span> : today.map(row)}
          </section>
        )
      })}
      {undated.length > 0 && (
        <section aria-label={days.length === 0 ? 'Itinerary' : 'Undated'}>
          <div className="flex items-baseline justify-between border-b border-separator pb-1.5">
            <span className="text-subheadline font-semibold text-label">{days.length === 0 ? 'Itinerary' : 'Undated'}</span>
          </div>
          {undated.sort(byTime).map(row)}
        </section>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
        className="flex flex-wrap gap-1.5"
      >
        <input
          ref={addRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Add an itinerary item"
          placeholder="Add: day 2 19:30 Dinner at Narisawa"
          className={cn(fieldClass, 'min-w-0 basis-full py-1.5 sm:basis-0 sm:flex-1')}
        />
        <ActionButton type="submit" size="sm" className="self-center">
          Add
        </ActionButton>
        <ActionButton size="sm" className="self-center" onClick={() => setReserving(true)}>
          Add reservation
        </ActionButton>
      </form>
      {reserving && <ReservationForm trip={trip} days={days} run={run} onDone={() => setReserving(false)} />}
    </>
  )
}

/** One item edited in place, two columns: the drawer is 512px at its widest. */
function ItemEditor({ item, days, onDone, run }: { item: Item; days: string[]; onDone: () => void; run: Run }) {
  const [d, setD] = useState({
    title: item.title,
    time: item.occursAt ?? '',
    day: item.occursOn ?? '',
    kind: item.kind as Kind,
    status: item.status === 'idea' ? 'idea' : 'confirmed',
    place: item.place,
    amount: item.amountCents ? String(item.amountCents / 100) : '',
    confirmation: item.confirmation,
    detail: item.detail,
  })
  const set = (key: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD((v) => ({ ...v, [key]: e.target.value }))
  const amount = d.amount.trim() === '' ? 0 : Number(d.amount.replace(/[$,]/g, ''))
  const { errors, ref, submit } = useFormErrors(() => ({
    title: d.title.trim() ? undefined : 'Title is required',
    amount: Number.isFinite(amount) && amount >= 0 ? undefined : 'Amount must be a number',
  }))
  const save = () => {
    if (!submit()) return
    run(
      () =>
        saveItem({
          id: item.id,
          title: d.title.trim(),
          kind: d.kind,
          status: d.status as 'idea' | 'confirmed',
          detail: d.detail,
          place: d.place.trim(),
          confirmation: d.confirmation.trim(),
          amount_cents: Math.round(amount * 100),
          occurs_at: d.time || null,
          occurs_on: d.day || null,
        }),
      'Saved',
      onDone,
    )
  }
  return (
    <form
      ref={ref}
      aria-label={`Edit ${item.title}`}
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      className="grid grid-cols-2 gap-2.5 border-b border-separator py-3"
    >
      <div className="col-span-2">
        <Field label="Title" required error={errors.title}>
          <input aria-label="Title" value={d.title} onChange={set('title')} className={field} />
        </Field>
      </div>
      <Field label="Time">
        <input type="time" aria-label="Time" value={d.time} onChange={set('time')} className={cn(field, 'num')} />
      </Field>
      <Field label="Day">
        <select aria-label="Day" value={d.day} onChange={set('day')} className={field}>
          <option value="">No day</option>
          {/* A date outside the trip's days stays selectable, so saving does not move it. */}
          {d.day && !days.includes(d.day) && <option value={d.day}>{shortDate(d.day)}</option>}
          {days.map((day, i) => (
            <option key={day} value={day}>
              Day {i + 1} · {shortDate(day)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Kind">
        <select aria-label="Kind" value={d.kind} onChange={set('kind')} className={field}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {cap(k)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Status">
        <select aria-label="Status" value={d.status} onChange={set('status')} className={field}>
          <option value="confirmed">Confirmed</option>
          <option value="idea">Idea</option>
        </select>
      </Field>
      <Field label="City">
        <input aria-label="City" value={d.place} onChange={set('place')} placeholder="The day's city" className={field} />
      </Field>
      <Field label="Amount" error={errors.amount}>
        <input aria-label="Amount" inputMode="decimal" value={d.amount} onChange={set('amount')} placeholder="$" className={cn(field, 'num')} />
      </Field>
      <Field label="Confirmation">
        <input aria-label="Confirmation" value={d.confirmation} onChange={set('confirmation')} className={field} />
      </Field>
      <Field label="Details">
        <input aria-label="Details" value={d.detail} onChange={set('detail')} className={field} />
      </Field>
      <div className="col-span-2 flex justify-end gap-1.5">
        <ActionButton size="sm" onClick={onDone}>
          Cancel
        </ActionButton>
        <ActionButton size="sm" variant="accent" type="submit">
          Save
        </ActionButton>
      </div>
    </form>
  )
}

/**
 * A reservation is a confirmed itinerary item with who it is with, its code,
 * and the confirmation itself if there is a file. Inline in the tab rather
 * than an overlay on the drawer.
 */
function ReservationForm({ trip, days, run, onDone }: { trip: Trip; days: string[]; run: Run; onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const { errors, ref, submit } = useFormErrors(() => ({
    title: title.trim() ? undefined : 'Reservation is required',
    amount: amount.trim() === '' || Number.isFinite(Number(amount.replace(/[$,]/g, ''))) ? undefined : 'Amount must be a number',
  }))
  return (
    <Card className="px-3.5 py-3">
      <form
        ref={ref}
        aria-label="Add reservation"
        onSubmit={(e) => {
          e.preventDefault()
          if (!submit()) return
          const data = new FormData(e.currentTarget)
          run(() => saveReservation(data), 'Reservation added', onDone)
        }}
        className="grid grid-cols-2 gap-2.5"
      >
        <input type="hidden" name="trip_id" value={trip.id} />
        <div className="col-span-2">
          <Field label="Reservation" required error={errors.title}>
            <input name="title" aria-label="Reservation" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Hotel Sacher, 3 nights" className={field} />
          </Field>
        </div>
        <Field label="Provider">
          <input name="provider" aria-label="Provider" placeholder="Booking.com" className={field} />
        </Field>
        <Field label="Confirmation code">
          <input name="confirmation" aria-label="Confirmation code" className={field} />
        </Field>
        <Field label="Date">
          <input
            type="date"
            name="occurs_on"
            aria-label="Date"
            defaultValue={days[0] ?? ''}
            min={days[0]}
            max={days[days.length - 1]}
            className={cn(field, 'num')}
          />
        </Field>
        <Field label="Time">
          <input type="time" name="occurs_at" aria-label="Reservation time" className={cn(field, 'num')} />
        </Field>
        <Field label="Kind">
          <select name="kind" aria-label="Reservation kind" defaultValue="lodging" className={field}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {cap(k)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount" error={errors.amount}>
          <input name="amount" aria-label="Reservation amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$" className={cn(field, 'num')} />
        </Field>
        <div className="col-span-2">
          <Field label="Confirmation file">
            <input type="file" name="file" aria-label="Confirmation file" accept="application/pdf,image/*" className={cn(field, 'py-1.5')} />
          </Field>
        </div>
        <div className="col-span-2 flex justify-end gap-1.5">
          <ActionButton size="sm" onClick={onDone}>
            Cancel
          </ActionButton>
          <ActionButton size="sm" variant="accent" type="submit">
            Save reservation
          </ActionButton>
        </div>
      </form>
    </Card>
  )
}
