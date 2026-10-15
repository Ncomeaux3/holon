import { cache } from 'react'
import type { WeekStart } from './clock'
import { db } from './db'

// The handful of knobs a fork needs without touching .env. Everything here is
// owner-editable on the Settings page; anything infrastructural stays in .env.
export type Settings = {
  timezone: string
  owner_name: string
  /** Hour of the local day the digest is written for. The cron itself is 09:00 UTC. */
  digest_hour: number
  /** Month to date ceiling on model spend. Past this, research calls refuse. */
  llm_soft_cap_cents: number
  /**
   * Which modules show in nav and in the Onboarding toggles. Visibility only:
   * jobs, tools and direct URLs still work for a module that is off, so
   * deleting the folder is still the real removal. null means every module.
   */
  modules_enabled: string[] | null
  /**
   * How much an agent may do without asking. See core/tools.ts shouldGuard.
   * observe: everything proposes. propose: the manifest's guarded list applies.
   * act: nothing is held back, and undo in the Agent Log is the safety net.
   */
  agent_autonomy: 'observe' | 'propose' | 'act'
  /**
   * Where the daily digest goes. Empty means OWNER_EMAIL.
   *
   * Separate from OWNER_EMAIL on purpose: that one is the login and changing it
   * locks you out. This is only a recipient, and it has to be able to differ,
   * because Resend without a verified domain will only deliver to the address
   * the Resend account was created with.
   */
  digest_email: string
  /**
   * When the two digests are composed, local, as "HH:MM". The design's time
   * inputs carry minutes (06:30), so these are strings rather than the hour
   * integer digest_hour uses for the cron.
   */
  digest_morning_at: string
  digest_morning_enabled: boolean
  digest_evening_at: string
  digest_evening_enabled: boolean
  /**
   * Quiet hours, local, as "HH:MM". They wrap midnight: from 22:00 to 06:30 is
   * the overnight window, not an empty one.
   */
  quiet_from: string
  quiet_to: string
  /** Whether an urgent rule is allowed through quiet hours at all. */
  quiet_urgent_override: boolean
  /** The master switch. Rules keep their own state underneath it. */
  notifications_paused: boolean
  /**
   * When first run was finished, as an ISO timestamp. Empty means it has not
   * been, which is what sends a fresh install to the wizard.
   *
   * A timestamp rather than a boolean so a fork can tell a database set up last
   * year from one set up this morning, which matters when deciding whether an
   * empty module is new or abandoned.
   */
  onboarding_completed_at: string
  /**
   * The dashboard's tile order and which tiles are hidden. One layout for the
   * phone and the desktop (2026-09-14 decision), stored here rather than in
   * localStorage so every device shows the same bento. null is the default
   * order with nothing hidden.
   */
  dashboard_layout: { order: string[]; hidden: string[] } | null
  /** The day every week starts on, for every module (core/clock.ts startOfWeek). */
  week_start: WeekStart
  /** The weekly review's day, 0 Sunday to 6 Saturday, and its local "HH:MM". */
  review_day: number
  review_time: string
  /** An in-app alert at the review's day and time, queued nightly. */
  review_reminder: boolean
  /** A repeating "Weekly review" task on the review day. */
  review_task: boolean
}
export type SettingKey = keyof Settings

export const DEFAULT_SETTINGS: Settings = {
  timezone: 'America/Chicago',
  owner_name: '',
  digest_hour: 9,
  llm_soft_cap_cents: 1000,
  modules_enabled: null,
  // The cautious default: a fork starts by proposing, not acting.
  agent_autonomy: 'propose',
  digest_email: '',
  digest_morning_at: '06:30',
  digest_morning_enabled: true,
  digest_evening_at: '20:00',
  digest_evening_enabled: true,
  quiet_from: '22:00',
  quiet_to: '06:30',
  quiet_urgent_override: true,
  notifications_paused: false,
  onboarding_completed_at: '',
  dashboard_layout: null,
  week_start: 'monday',
  review_day: 0,
  review_time: '18:00',
  review_reminder: false,
  review_task: false,
}

// Both readers are memoised per request with React cache(): the layout and
// the page each read settings, and getNav and getOffRailNav each read
// modules_enabled, so one render was four round trips for one row. Outside a
// render (jobs, tools, tests) cache() is a plain call, and a request that
// writes a setting re-renders in a fresh pass, so nothing goes stale.
export const getSetting = cache(async <K extends SettingKey>(key: K): Promise<Settings[K]> => {
  const { rows } = await db().query<{ value: Settings[K] }>(
    'select value from core.settings where key = $1',
    [key],
  )
  return rows.length > 0 ? rows[0].value : DEFAULT_SETTINGS[key]
})

export const getSettings = cache(async (): Promise<Settings> => {
  const { rows } = await db().query<{ key: SettingKey; value: unknown }>(
    'select key, value from core.settings',
  )
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return { ...DEFAULT_SETTINGS, ...stored }
})

export async function setSetting<K extends SettingKey>(key: K, value: Settings[K]): Promise<void> {
  await db().query(
    `insert into core.settings (key, value) values ($1, $2::jsonb)
     on conflict (key) do update set value = excluded.value`,
    [key, JSON.stringify(value)],
  )
}
