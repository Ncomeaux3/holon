import { db } from '@/core/db'

// Reads for the screen and the digest. The schedule arithmetic lives in
// ./schedule.ts, which has no imports and can be pulled into a client.

export type Fact = { label: string; value: string }

export type AssetRow = {
  id: string
  kind: string
  name: string
  subtitle: string
  value_cents: string
  annual_cost_cents: string
  value_as_of: string | null
  acquired_on: string | null
  notes: string
  facts: Fact[]
}

export async function listAssets(): Promise<AssetRow[]> {
  const { rows } = await db().query<AssetRow>(
    `select id, kind, name, subtitle, value_cents::text, annual_cost_cents::text,
            value_as_of::text, acquired_on::text, notes, facts
       from home.asset
      where archived = false
      order by
        -- Property, then vehicles, then the equipment. Biggest thing first is
        -- the order a person thinks about the list in.
        case kind when 'property' then 0 when 'vehicle' then 1 else 2 end,
        value_cents desc`,
  )
  return rows
}

export type ServiceRow = {
  id: string
  asset_id: string
  asset_name: string
  title: string
  interval_months: number
  last_done_on: string | null
  due_on: string | null
  snooze_until: string | null
  cost_estimate_cents: number
  notes: string
  vendor_id: string | null
  vendor_name: string | null
}

export async function listServices(): Promise<ServiceRow[]> {
  const { rows } = await db().query<ServiceRow>(
    `select s.id, s.asset_id, a.name as asset_name, s.title, s.interval_months,
            s.last_done_on::text, s.due_on::text, s.snooze_until::text,
            s.cost_estimate_cents, s.notes, s.vendor_id, v.name as vendor_name
       from home.service s
       join home.asset a on a.id = s.asset_id
       left join home.vendor v on v.id = s.vendor_id
      where s.active = true and a.archived = false
      order by a.name, s.title`,
  )
  return rows
}

export type LogRow = {
  id: string
  asset_id: string
  what: string
  done_on: string
  cost_cents: number | null
  vendor_name: string | null
  notes: string
}

/** The four columns the schedule arithmetic reads, in the shape it wants. */
export function toSchedule(s: ServiceRow) {
  return {
    intervalMonths: s.interval_months,
    lastDoneOn: s.last_done_on,
    dueOn: s.due_on,
    snoozeUntil: s.snooze_until,
  }
}

export async function listServiceLog(limit = 120): Promise<LogRow[]> {
  const { rows } = await db().query<LogRow>(
    `select l.id, l.asset_id, l.what, l.done_on::text, l.cost_cents, l.notes,
            v.name as vendor_name
       from home.service_log l
       left join home.vendor v on v.id = l.vendor_id
      order by l.done_on desc
      limit $1`,
    [limit],
  )
  return rows
}

export type WarrantyRow = {
  id: string
  asset_id: string | null
  name: string
  detail: string
  cover: string
  expires_on: string | null
  document_url: string
  facts: Fact[]
}

export async function listWarranties(): Promise<WarrantyRow[]> {
  const { rows } = await db().query<WarrantyRow>(
    `select w.id, w.asset_id, w.name, w.detail, w.cover, w.expires_on::text, w.document_url, w.facts
       from home.warranty w
       left join home.asset a on a.id = w.asset_id
      -- An archived asset's cover goes with it; a deed on no asset stays.
      where a.archived is not true
      -- Nulls last: a deed does not expire, and it is not the most urgent row
      -- on the screen for want of a date.
      order by expires_on asc nulls last`,
  )
  return rows
}

export type VendorRow = {
  id: string
  name: string
  trade: string
  contact: string
  last_used_on: string | null
  last_cost_cents: number | null
}

export async function listVendors(): Promise<VendorRow[]> {
  const { rows } = await db().query<VendorRow>(
    `select v.id, v.name, v.trade, v.contact,
            l.done_on::text as last_used_on, l.cost_cents as last_cost_cents
       from home.vendor v
       -- The last job they did, from the history rather than a field that
       -- would have to be kept in step with it.
       left join lateral (
         select done_on, cost_cents from home.service_log
          where vendor_id = v.id order by done_on desc limit 1
       ) l on true
      order by l.done_on desc nulls last, v.name`,
  )
  return rows
}

export async function ownerToday(): Promise<string> {
  const { rows } = await db().query<{ today: string }>(`select core.today()::text as today`)
  return rows[0].today
}
