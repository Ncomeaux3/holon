import { db } from '@/core/db'
import { register } from '@/core/entities'

// Synthetic rows for `pnpm setup --demo`. Upserts on external_id so running it
// twice does not duplicate. Nothing here is personal or medically meaningful;
// this ships in the template, so the values are plausible placeholders and the
// screen never offers an opinion about any of them.

const PROVIDERS = [
  { external_id: 'gp', name: 'Dr Okafor', role: 'Primary care', phone: '555 0163', address: 'Main clinic, Suite 340', notes: 'Referrals go through the portal.' },
  { external_id: 'dentist', name: 'Riverside Dental', role: 'Dentist', phone: '555 0177', address: 'Riverside', notes: '' },
  { external_id: 'optom', name: 'Clearview Optical', role: 'Optometrist', phone: '555 0198', address: 'Clearview', notes: '' },
]

const APPOINTMENTS = [
  { external_id: 'appt-physical', what: 'Annual physical', provider: 'gp', inDays: 12, at: '09:30', location: 'Main clinic', prep: 'Fast twelve hours. Bring the current medication list.', cost: 3500 },
  { external_id: 'appt-cleaning', what: 'Dental cleaning', provider: 'dentist', inDays: 31, at: '14:00', location: 'Riverside', prep: '', cost: 9_500 },
  { external_id: 'appt-eyes', what: 'Eye exam', provider: 'optom', inDays: -48, at: '11:15', location: 'Clearview', prep: '', cost: 7500, status: 'done' as const },
]

const MEDICATIONS = [
  { external_id: 'med-d', name: 'Vitamin D', dose: '1000 IU', schedule: 'Daily, with breakfast', refillInDays: 9 },
  { external_id: 'med-mag', name: 'Magnesium', dose: '300 mg', schedule: 'Daily, evening', refillInDays: 40 },
]

/** Clinical readings only. Weight and resting heart rate belong to Fitness. */
const VITALS = [
  { metric: 'blood_pressure', value: 122, text: '122/78', daysAgo: 48, provenance: 'lab' },
  { metric: 'ldl', value: 102, text: '102 mg/dL', daysAgo: 48, provenance: 'lab' },
  // A reading before the current one, so the tile can show a delta.
  { metric: 'ldl', value: 111, text: '111 mg/dL', daysAgo: 412, provenance: 'lab' },
  { metric: 'hdl', value: 54, text: '54 mg/dL', daysAgo: 48, provenance: 'lab' },
  { metric: 'a1c', value: 5.4, text: '5.4%', daysAgo: 48, provenance: 'lab' },
]

const SCREENINGS = [
  // One of each state, so the screen shows what it is for rather than a column
  // of green.
  { name: 'Annual physical', months: 12, lastDoneDaysAgo: 400 },
  { name: 'Dental cleaning', months: 6, lastDoneDaysAgo: 150 },
  { name: 'Eye exam', months: 24, lastDoneDaysAgo: 48 },
  { name: 'Skin check', months: 12, lastDoneDaysAgo: null },
]

export async function seed(): Promise<number> {
  const providers = new Map<string, string>()
  for (const p of PROVIDERS) {
    const { rows } = await db().query<{ id: string }>(
      `insert into health.provider (name, role, phone, address, notes, source, external_id)
       values ($1, $2, $3, $4, $5, 'demo', $6)
       on conflict (source, external_id) do update set name = excluded.name, address = excluded.address
       returning id`,
      [p.name, p.role, p.phone, p.address, p.notes, p.external_id],
    )
    providers.set(p.external_id, rows[0].id)
  }

  for (const a of APPOINTMENTS) {
    const { rows } = await db().query<{ id: string }>(
      `insert into health.appointment
         (provider_id, what, starts_at, location, status, prep, cost_estimate_cents,
          source, external_id)
       values ($1, $2,
               -- The time is the owner's, not the database's: 09:30 in Chicago.
               ((core.today() + $3::int)::text || ' ' || $4)::timestamp
                 at time zone coalesce((select value #>> '{}' from core.settings where key = 'timezone'), 'UTC'),
               $5, $6, $7, $8, 'demo', $9)
       on conflict (source, external_id) do update
         set starts_at = excluded.starts_at, status = excluded.status
       returning id`,
      [
        providers.get(a.provider) ?? null,
        a.what,
        a.inDays,
        a.at,
        a.location,
        a.status ?? 'confirmed',
        a.prep,
        a.cost,
        a.external_id,
      ],
    )

    await register({
      module: 'health',
      entityType: 'appointment',
      entityId: rows[0].id,
      title: a.what,
      text: a.prep,
    })
  }

  for (const m of MEDICATIONS) {
    const { rows } = await db().query<{ id: string }>(
      `insert into health.medication
         (name, dose, schedule, started_on, refill_on, source, external_id)
       values ($1, $2, $3, core.today() - 200, core.today() + $4::int, 'demo', $5)
       on conflict (source, external_id) do update set refill_on = excluded.refill_on
       returning id`,
      [m.name, m.dose, m.schedule, m.refillInDays, m.external_id],
    )

    // A run of marks ending yesterday, so the streak is non-zero and today is
    // still yours to tick. Nothing here marks today for you.
    await db().query(`delete from health.medication_log where medication_id = $1`, [rows[0].id])
    await db().query(
      `insert into health.medication_log (medication_id, taken_on)
       select $1, core.today() - g from generate_series(1, 6) as g
       on conflict (medication_id, taken_on) do nothing`,
      [rows[0].id],
    )
  }

  // Measured at a day relative to today, so every reseed on a new day would
  // add a row; the demo history is exactly this list.
  await db().query(`delete from health.vital where source = 'demo'`)
  for (const v of VITALS) {
    await db().query(
      `insert into health.vital
         (metric, value, value_text, measured_at, provenance, source, external_id)
       values ($1, $2, $3, (core.today() - $4::int)::timestamptz, $5, 'demo', $6)
       on conflict (metric, measured_at, provenance) do update set value = excluded.value`,
      [v.metric, v.value, v.text, v.daysAgo, v.provenance, `vital-${v.metric}`],
    )
  }

  // Registered like the write tool does, so a demo record has the registry
  // row the skill picker links against.
  const RECORDS = [
    ['Annual lab panel', 'lab', 'Lipids, metabolic panel, thyroid. Filed as received.',
      '{"Ordered by": "Dr Okafor", "LDL": "102 mg/dL", "HDL": "54 mg/dL", "A1c": "5.4%"}', 'record-labs'],
    ['Eye exam prescription', 'vision', 'Unchanged from last year.',
      '{"Provider": "Clearview Optical", "Valid until": "two years from the exam"}', 'record-eyes'],
  ]
  for (const [title, kind, summary, fields, externalId] of RECORDS) {
    const { rows } = await db().query<{ id: string }>(
      `insert into health.record (title, kind, taken_on, summary, fields, source, external_id)
       values ($1, $2, core.today() - 48, $3, $4::jsonb, 'demo', $5)
       on conflict (source, external_id) do update set taken_on = excluded.taken_on, fields = excluded.fields
       returning id`,
      [title, kind, summary, fields, externalId],
    )
    await register({ module: 'health', entityType: 'record', entityId: rows[0].id, title, text: summary })
  }

  for (const s of SCREENINGS) {
    await db().query(
      `insert into health.screening (name, interval_months, last_done_on)
       values ($1, $2,
               case when $3::int is null then null else core.today() - $3::int end)
       on conflict (name) do update set last_done_on = excluded.last_done_on`,
      [s.name, s.months, s.lastDoneDaysAgo],
    )
  }

  return APPOINTMENTS.length + MEDICATIONS.length + SCREENINGS.length
}
