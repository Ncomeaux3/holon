'use client'

import { useState, useTransition } from 'react'
import {
  ActionButton,
  Card,
  Alert,
  CardHead,
  EmptyState,
  Eyebrow,
  MetricStrip,
  MetricTile,
  PageHeader,
  Row,
  RowList,
  StatusChip,
  useToast,
  type SkillLink,
} from '@/components/pos'
import { useSearchState } from '@/components/pos/searchState'
import { cn } from '@/lib/utils'
import { deleteTrip, setTripStatus, type ActionResult } from './actions'
import { Globe } from './Globe'
import { LoyaltyDrawer } from './LoyaltyDrawer'
import { pinsFor, pinTarget } from './pins'
import { PlaceDrawer } from './PlaceDrawer'
import { TripDrawer } from './TripDrawer'

// The Travel screen, as POS Travel.dc.html draws it: the band, the loyalty
// strip, the title with its two buttons, the globe, then Upcoming as cards
// and Past beside Wishlist. A trip opens as a drawer; a wish is a trip whose
// status is idea.

export type TravelData = {
  todayIso: string
  trips: {
    id: string
    name: string
    destination: string
    lat: number | null
    lon: number | null
    startsOn: string | null
    endsOn: string | null
    budgetCents: number
    /** The confirmed itinerary's amounts. */
    plannedCents: number
    /** The transactions Finance has tagged to this trip. */
    spentCents: number
    travellers: number
    status: string
    notes: string
    itemCount: number
    pendingCount: number
    packed: number
    toPack: number
    entityRef: string | null
    skills: SkillLink[]
  }[]
  /** Every trip's cities, in the owner's order. Flat, joined by tripId. */
  destinations: {
    id: string
    tripId: string
    name: string
    lat: number | null
    lon: number | null
    startsOn: string | null
    endsOn: string | null
    position: number
  }[]
  itinerary: {
    id: string
    tripId: string
    kind: string
    title: string
    detail: string
    occursOn: string | null
    occursAt: string | null
    amountCents: number
    confirmation: string
    status: string
    confidence: number | null
    place: string
    provider: string
    hasFile: boolean
  }[]
  packing: { id: string; tripId: string; label: string; packed: boolean }[]
  budgetLines: {
    id: string
    tripId: string
    category: string
    plannedCents: number
    actualOverrideCents: number | null
  }[]
  places: { id: string; tripId: string | null; name: string; country: string; lat: number; lon: number; visitedOn: string | null }[]
  loyalty: {
    id: string
    name: string
    kind: string
    balance: number
    previousBalance: number | null
    statusTier: string
    updatedAt: string
    accountRef: string | null
    /** Charges on the linked account last calendar month, null with no account linked. */
    lastMonthCents: number | null
  }[]
  /** Finance accounts a program can be linked to, from the registry. */
  accounts: { ref: string; title: string }[]
  /** "Sep": the month lastMonthCents covers. */
  lastMonthLabel: string
  /** The unread travel notification for the band on the globe, if any. */
  alert: { id: string; title: string; body: string } | null
  /** The live flight check-in rule's trigger text, for the drawer's footer. */
  checkinTrigger: string | null
  /** Every skill in the tree, id and name. From getSkillNames() on the page. */
  skills: [string, string][]
}

export type Trip = TravelData['trips'][number]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY = 86_400_000

const at = (iso: string) => new Date(`${iso}T12:00:00`)
export const money = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

/** "Nov 5 – Nov 14", with the year when it is not this one. */
export function dateRange(trip: Trip, todayIso: string): string {
  if (!trip.startsOn) return 'no date'
  const s = at(trip.startsOn)
  const e = trip.endsOn ? at(trip.endsOn) : null
  const year = e && e.getFullYear() !== at(todayIso).getFullYear() ? ` ${e.getFullYear()}` : ''
  const one = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return e ? `${one(s)} – ${one(e)}${year}` : `${one(s)}${year}`
}

export function nights(trip: Trip): number {
  if (!trip.startsOn || !trip.endsOn) return 0
  return Math.max(0, Math.round((at(trip.endsOn).getTime() - at(trip.startsOn).getTime()) / DAY))
}

const daysUntil = (iso: string, todayIso: string) =>
  Math.max(0, Math.round((at(iso).getTime() - at(todayIso).getTime()) / DAY))

const KINDS = ['flight', 'lodging', 'transit', 'activity'] as const
const KIND_COLOUR: Record<(typeof KINDS)[number], string> = {
  flight: 'bg-accent',
  lodging: 'bg-secondary-label',
  transit: 'bg-gray',
  activity: 'bg-orange',
}

export function Travel({ data }: { data: TravelData }) {
  const { params, set: setParams } = useSearchState()
  const [, start] = useTransition()
  const toast = useToast()
  const [removing, setRemoving] = useState<Trip | null>(null)

  const run = (action: () => Promise<ActionResult>, ok?: string) =>
    start(async () => {
      const result = await action()
      if (!result.ok) toast(result.error)
      else if (ok) toast(ok)
    })

  const today = data.todayIso
  const isPast = (t: Trip) => t.status === 'done' || (t.endsOn !== null && t.endsOn < today)
  const upcoming = data.trips
    .filter((t) => (t.status === 'planned' || t.status === 'booked') && !isPast(t))
    .sort((a, b) => (a.startsOn ?? '').localeCompare(b.startsOn ?? ''))
  const past = data.trips.filter(isPast).sort((a, b) => (b.startsOn ?? '').localeCompare(a.startsOn ?? ''))
  const wishlist = data.trips.filter((t) => t.status === 'idea')

  const nightsAway = upcoming.reduce((sum, t) => sum + nights(t), 0)
  // A past trip's cost is the larger of the two, the same rule Remaining uses:
  // one with no tagged transactions still cost what was booked.
  const cost = (t: Trip) => Math.max(t.plannedCents, t.spentCents)
  const pastSpend = past.reduce((sum, t) => sum + cost(t), 0)

  // Upcoming trips in the accent, places visited and past trips in grey, wishes
  // as dashed rings. Which trip becomes which pin is in ./pins.ts, tested.
  const pins = pinsFor({ upcoming, past, wishlist, destinations: data.destinations, places: data.places })

  const openTrip = data.trips.find((t) => t.id === params.get('trip')) ?? null
  const openPlace = data.places.find((p) => p.id === params.get('place')) ?? null
  const form = params.get('new') // 'trip' | 'wish' | null
  const loyaltyOpen = params.get('loyalty') === '1'

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            Travel <span className="text-secondary-label">/</span> Trips
          </>
        }
        title="Travel"
        lede="Upcoming trips in blue, past in grey, wishlist dotted. Drag to rotate, scroll to zoom, tap a pin to open it, double-click to fly in."
        status={
          <Eyebrow dot={upcoming.length > 0 ? 'brand' : 'idle'} className="whitespace-nowrap">
            {upcoming.length} upcoming · {nightsAway} nights away
          </Eyebrow>
        }
        actions={
          <>
            <ActionButton onClick={() => setParams({ new: 'wish', trip: null }, { push: true })}>Add to wishlist</ActionButton>
            <ActionButton variant="solid" size="xl" onClick={() => setParams({ new: 'trip', trip: null }, { push: true })}>
              New trip <span aria-hidden="true">&rarr;</span>
            </ActionButton>
          </>
        }
        phoneAction={
          <>
            <ActionButton size="pill" aria-label="Add to wishlist" onClick={() => setParams({ new: 'wish', trip: null }, { push: true })}>
              Wishlist
            </ActionButton>
            <ActionButton size="pill" variant="solid" onClick={() => setParams({ new: 'trip', trip: null }, { push: true })}>
              New trip
            </ActionButton>
          </>
        }
      />

      {/* The loyalty strip: one tile per program, the balance with its move
        * since the last entry, and Manage on the last tile. Under the header
        * now rather than between the band and the title. */}
      {data.loyalty.length > 0 && (
        <MetricStrip data-testid="travel-loyalty" className="mt-[18px]">
          {data.loyalty.map((l, i) => {
            const delta = l.previousBalance === null ? null : l.balance - l.previousBalance
            const last = i === data.loyalty.length - 1
            return (
              <MetricTile
                key={l.id}
                size="sm"
                label={
                  <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-2">
                    <span className="min-w-0">{l.name}</span>
                    {last && (
                      <ActionButton
                        size="sm"
                        variant="quiet"
                        className="-my-2 -mr-2 shrink-0"
                        onClick={() => setParams({ loyalty: '1' }, { push: true })}
                      >
                        Manage →
                      </ActionButton>
                    )}
                  </span>
                }
                value={l.balance.toLocaleString('en-US')}
                delta={
                  delta !== null && delta !== 0
                    ? `${delta > 0 ? '+' : ''}${delta.toLocaleString('en-US')}`
                    : undefined
                }
                deltaTone={delta !== null && delta < 0 ? 'bad' : 'ok'}
              />
            )
          })}
        </MetricStrip>
      )}

      <div data-testid="travel-globe" className="relative mt-[18px] h-[clamp(240px,38vh,420px)] rounded-card border border-separator bg-grouped-2">
        <Globe
          pins={pins}
          onPick={(id) => {
            const target = pinTarget(id, data.places, (t) => data.trips.some((trip) => trip.id === t))
            if (target && 'trip' in target) setParams({ trip: target.trip, new: null, place: null }, { push: true })
            else if (target) setParams({ place: target.place, trip: null, new: null }, { push: true })
          }}
          alert={
            data.alert && (
              <div className="flex items-center gap-2.5 rounded-card bg-grouped-2 px-3 py-2 ring-1 ring-orange">
                <StatusChip tone="warn">Alert</StatusChip>
                <span className="min-w-0 text-footnote text-label">{data.alert.title}</span>
              </div>
            )
          }
        />
      </div>

      <div data-testid="travel-sections" className="mt-[18px] flex flex-col gap-5 pb-7">
        <section>
          <CardHead label="Upcoming" plainMeta meta={upcoming.length === 0 ? 'nothing booked' : `${upcoming.length} ${upcoming.length === 1 ? 'trip' : 'trips'} · next in ${daysUntil(upcoming[0].startsOn ?? today, today)} days`} className="mb-3" />
          {upcoming.length === 0 ? (
            <EmptyState headline="Nothing planned">No trip is planned. New trip starts one.</EmptyState>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3.5">
              {upcoming.map((t) => {
                const items = data.itinerary.filter((i) => i.tripId === t.id && i.status === 'confirmed')
                const booked = KINDS.filter((k) => items.some((i) => i.kind === k))
                const toPack = t.toPack - t.packed
                const next =
                  t.pendingCount > 0
                    ? `Approve ${t.pendingCount} parsed ${t.pendingCount === 1 ? 'booking' : 'bookings'}`
                    : !items.some((i) => i.kind === 'lodging')
                      ? 'Book lodging'
                      : toPack > 0
                        ? `Pack · ${toPack} ${toPack === 1 ? 'item' : 'items'} left`
                        : ''
                return (
                  <Card
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setParams({ trip: t.id, new: null }, { push: true })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setParams({ trip: t.id, new: null }, { push: true })
                      }
                    }}
                    className="cursor-pointer px-[18px] text-left transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-fill-4"
                  >
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="min-w-0">
                        <span className="block text-callout font-semibold text-label">{t.name}</span>
                        <span className="mt-1 block text-footnote text-secondary-label">
                          {dateRange(t, today)} · {nights(t)} nights
                        </span>
                      </div>
                      {t.startsOn && (
                        <span className="num shrink-0 text-title-3 leading-none text-accent">
                          {daysUntil(t.startsOn, today)}
                          <span className="text-caption-1 text-secondary-label"> d</span>
                        </span>
                      )}
                    </div>
                    <div className="mt-3.5 flex gap-px bg-separator">
                      {KINDS.map((k) => (
                        <span
                          key={k}
                          title={`${k} · ${booked.includes(k) ? 'booked' : 'open'}`}
                          className={cn('h-[3px] flex-1', booked.includes(k) ? KIND_COLOUR[k] : 'bg-grouped-2')}
                        />
                      ))}
                    </div>
                    <div className="mt-2 flex justify-between gap-2.5 text-footnote text-secondary-label">
                      <span>
                        {booked.length}/4 booked{t.pendingCount > 0 ? ` · ${t.pendingCount} in inbox` : ''}
                      </span>
                      <span className="text-right">
                        Spent {money(t.spentCents)} ·{' '}
                        <span className="whitespace-nowrap">
                          planned {money(t.plannedCents)} / {money(t.budgetCents)}
                        </span>
                      </span>
                    </div>
                    {next && (
                      <div className="mt-2.5 truncate border-t border-separator pt-2.5 text-footnote text-label">
                        <span className="text-secondary-label">Next · </span>
                        {next}
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          )}
        </section>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-5">
          <section>
            <CardHead label="Past" plainMeta meta={`${past.length} ${past.length === 1 ? 'trip' : 'trips'} · ${money(pastSpend)} total`} className="mb-3" />
            {past.length === 0 ? (
              <EmptyState headline="Nothing yet">A trip moves here once it is done.</EmptyState>
            ) : (
              <RowList>
                {past.map((t) => (
                  <Row
                    key={t.id}
                    title={t.name}
                    meta={`${dateRange(t, today)} · ${nights(t)} nights`}
                    amount={money(cost(t))}
                    onClick={() => setParams({ trip: t.id, new: null }, { push: true })}
                  />
                ))}
              </RowList>
            )}
          </section>

          <section>
            <CardHead label="Wishlist" plainMeta meta={`${wishlist.length} ${wishlist.length === 1 ? 'place' : 'places'}`} className="mb-3" />
            {wishlist.length === 0 ? (
              <EmptyState headline="Nothing yet">Add to wishlist keeps a place for later.</EmptyState>
            ) : (
              <RowList>
                {wishlist.map((w) => (
                  <Row
                    key={w.id}
                    title={w.name}
                    meta={w.notes || undefined}
                    onClick={() => setParams({ trip: w.id, new: null }, { push: true })}
                    right={
                      <>
                        <ActionButton
                          size="sm"
                          variant="accent"
                          onClick={(e) => {
                            e.stopPropagation()
                            run(() => setTripStatus(w.id, 'planned'), `${w.name} is planned`)
                          }}
                        >
                          Plan
                        </ActionButton>
                        <ActionButton
                          size="sm"
                          aria-label={`Remove ${w.name}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setRemoving(w)
                          }}
                        >
                          ✕
                        </ActionButton>
                      </>
                    }
                  />
                ))}
              </RowList>
            )}
          </section>
        </div>
      </div>

      {/* One Alert for the wishlist, outside the rows: a ✕ keeps the row
        * narrow enough for its chevron at 402, and the Alert's own clicks
        * never reach a row's click target. */}
      <Alert
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove from the wishlist?"
        message={removing ? `${removing.name} is deleted.` : undefined}
        actions={[
          { label: 'Cancel', role: 'cancel' },
          { label: 'Remove', role: 'destructive', onPress: () => removing && run(() => deleteTrip(removing.id), 'Removed') },
        ]}
      />
      {(openTrip || form) && (
        <TripDrawer
          key={openTrip?.id ?? form}
          trip={openTrip}
          mode={form === 'wish' ? 'wish' : form === 'trip' ? 'trip' : null}
          data={data}
          tab={params.get('tab')}
          onTab={(tab) => setParams({ tab: tab === 'itin' ? null : tab })}
          onClose={() => setParams({ trip: null, new: null, tab: null })}
        />
      )}
      {openPlace && <PlaceDrawer place={openPlace} onClose={() => setParams({ place: null })} />}
      {loyaltyOpen && <LoyaltyDrawer loyalty={data.loyalty} accounts={data.accounts} monthLabel={data.lastMonthLabel} onClose={() => setParams({ loyalty: null })} />}
    </>
  )
}
