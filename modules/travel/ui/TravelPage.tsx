import { db } from '@/core/db'
import { getSkillNames, getSpend } from '@/core/modules'
import { listSkillLinks } from '@/core/skill-links'
import { ownerToday } from '@/core/today'
import {
  listBudgetLines,
  listAccountOptions,
  listDestinations,
  listItinerary,
  listLoyalty,
  listPacking,
  listPlaces,
  listTrips,
} from '../data'
import { Travel, type TravelData } from './Travel'

/** The unread travel alerts, for the band on the globe. */
async function travelAlerts(): Promise<{ id: string; title: string; body: string }[]> {
  const { rows } = await db().query<{ id: string; title: string; body: string }>(
    `select n.id, n.title, n.body
       from core.notifications n
       join core.notification_rules r on r.id = n.rule_id
      where r.module = 'travel' and n.read_at is null
      order by n.due_at desc
      limit 1`,
  )
  return rows
}

/** Whether the flight check-in rule is live, so the drawer's footer can say so truthfully. */
async function checkinRule(): Promise<{ trigger: string } | null> {
  const { rows } = await db().query<{ trigger_text: string; muted: boolean }>(
    `select trigger_text, muted from core.notification_rules
      where module = 'travel' and key = 'flight_checkin' limit 1`,
  )
  const rule = rows[0]
  return rule && !rule.muted ? { trigger: rule.trigger_text } : null
}

/** The calendar month before the one `today` (YYYY-MM-DD) is in: its first and last day, and "Sep". */
function previousMonth(today: string): { from: string; to: string; label: string } {
  const end = new Date(Date.parse(`${today.slice(0, 7)}-01T00:00:00Z`) - 86_400_000)
  return {
    from: `${end.toISOString().slice(0, 7)}-01`,
    to: end.toISOString().slice(0, 10),
    label: end.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
  }
}

export default async function TravelPage() {
  // Spend is keyed by registry ref, so it chains on the links read inside the
  // batch rather than waiting for the whole batch.
  const linksP = listSkillLinks('travel', 'trip')
  const loyaltyP = listLoyalty()
  // The loyalty row shows the linked card's charges last calendar month: the
  // bridge sends no statement dates, so a full month is the honest stand-in.
  // Chained on today inside the batch, like spend on the links.
  const lastMonthP = ownerToday().then(previousMonth)
  const [trips, destinations, itinerary, packing, places, loyalty, lines, alerts, checkin, todayIso, links, names, spend, accounts, cardSpend] =
    await Promise.all([
      listTrips(),
      listDestinations(),
      listItinerary(),
      listPacking(),
      listPlaces(),
      loyaltyP,
      listBudgetLines(),
      travelAlerts(),
      checkinRule(),
      ownerToday(),
      linksP,
      getSkillNames(),
      linksP.then((l) => getSpend([...l.values()].map((v) => v.entityRef))),
      listAccountOptions(),
      Promise.all([loyaltyP, lastMonthP]).then(([l, m]) =>
        getSpend(l.flatMap((p) => (p.account_ref ? [p.account_ref] : [])), m),
      ),
    ])

  const data: TravelData = {
    todayIso,
    trips: trips.map((t) => ({
      id: t.id,
      name: t.name,
      destination: t.destination,
      lat: t.lat === null ? null : Number(t.lat),
      lon: t.lon === null ? null : Number(t.lon),
      startsOn: t.starts_on,
      endsOn: t.ends_on,
      budgetCents: Number(t.budget_cents),
      plannedCents: Number(t.planned_cents),
      spentCents: spend[links.get(t.id)?.entityRef ?? '']?.cents ?? 0,
      travellers: t.travellers,
      status: t.status,
      notes: t.notes,
      itemCount: Number(t.item_count),
      pendingCount: Number(t.pending_count),
      packed: Number(t.packed),
      toPack: Number(t.to_pack),
      entityRef: links.get(t.id)?.entityRef ?? null,
      skills: links.get(t.id)?.skills ?? [],
    })),
    destinations: destinations.map((d) => ({
      id: d.id,
      tripId: d.trip_id,
      name: d.name,
      lat: d.lat,
      lon: d.lon,
      startsOn: d.starts_on,
      endsOn: d.ends_on,
      position: d.position,
    })),
    itinerary: itinerary.map((i) => ({
      id: i.id,
      tripId: i.trip_id,
      kind: i.kind,
      title: i.title,
      detail: i.detail,
      occursOn: i.occurs_on,
      occursAt: i.occurs_at === null ? null : i.occurs_at.slice(0, 5),
      amountCents: Number(i.amount_cents),
      confirmation: i.confirmation,
      status: i.status,
      confidence: i.confidence === null ? null : Number(i.confidence),
      place: i.place,
      provider: i.provider,
      hasFile: i.has_file,
    })),
    packing: packing.map((p) => ({ id: p.id, tripId: p.trip_id, label: p.label, packed: p.packed })),
    budgetLines: lines.map((l) => ({
      id: l.id,
      tripId: l.trip_id,
      category: l.category,
      plannedCents: l.planned_cents,
      actualOverrideCents: l.actual_override_cents,
    })),
    places: places.map((p) => ({
      id: p.id,
      tripId: p.trip_id,
      name: p.name,
      country: p.country,
      lat: Number(p.lat),
      lon: Number(p.lon),
      visitedOn: p.visited_on,
    })),
    loyalty: loyalty.map((l) => ({
      id: l.id,
      name: l.name,
      kind: l.kind,
      balance: l.balance,
      previousBalance: l.previous_balance,
      statusTier: l.status_tier,
      updatedAt: new Date(l.updated_at).toISOString(),
      accountRef: l.account_ref,
      lastMonthCents: l.account_ref ? (cardSpend[l.account_ref]?.cents ?? 0) : null,
    })),
    accounts,
    lastMonthLabel: previousMonth(todayIso).label,
    alert: alerts[0] ?? null,
    checkinTrigger: checkin?.trigger ?? null,
    skills: Object.entries(names),
  }

  return <Travel data={data} />
}
