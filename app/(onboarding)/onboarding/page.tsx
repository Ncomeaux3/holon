import { loadCategories, supportedProviders } from '@/core/connectors'
import { db } from '@/core/db'
import { getModules } from '@/core/modules'
import { listMetrics } from '@/core/metrics'
import { getSettings } from '@/core/settings'
import { nightlyRunAt, ownerToday } from '@/core/today'
import { Onboarding, type SetupData } from './Onboarding'

/**
 * One true line per module, the artboard's own style ("Accounts, budgets,
 * subscriptions"). Trimmed from each module's README first line or its
 * get_digest description, never invented. A module this map has not heard of
 * (a fork's own addition) falls back to its nav label rather than a guess.
 */
const MODULE_NOTES: Record<string, string> = {
  finance: 'Net worth, budgets, subscriptions',
  tasks: 'Six views over one list, plus a month grid',
  calendar: 'Everything dated, from every module, by day',
  goals: 'Progress against a deadline, by life area',
  skills: 'XP from every event, across the tree',
  brain: 'Notes, links and drafts, with search',
  fitness: 'Workouts, sets, and body metrics',
  insurance: 'What is covered, what it costs, when it runs out',
  travel: 'Trips, what they cost, where you have been',
  meals: 'A week of slots, and the list to shop from',
  ideas: 'Effort against impact, four stages',
  health: 'Appointments, prescriptions, screenings',
  home: 'The house, the vehicles, the equipment',
  notes: 'Note counts and the most recent titles',
}

export default async function OnboardingPage() {
  const [settings, todayIso] = await Promise.all([getSettings(), ownerToday()])

  const modules = getModules()
  const enabled = settings.modules_enabled ?? modules.map((m) => m.id)

  // Requested providers only. A real connection is made at Settings, where a
  // secret can be handled properly, and is never touched from here.
  const { rows: requested } = await db().query<{ integration_id: string }>(
    `select integration_id from core.connections where status = 'requested'`,
  )

  const data: SetupData = {
    ownerName: settings.owner_name,
    timezone: settings.timezone,
    modules: modules.map((m) => ({
      id: m.id,
      label: m.nav.label,
      note: MODULE_NOTES[m.id] ?? `${m.nav.label} module`,
      enabled: enabled.includes(m.id),
    })),
    // Every category, not only the enabled ones: a category whose module is
    // off still renders, greyed, with an inline way to turn that module on
    // (the artboard's own shape), rather than disappearing.
    categories: loadCategories(),
    supported: [...supportedProviders()],
    requested: requested.map((r) => r.integration_id),
    // Enumerated from the manifests, so a seeded goal can point at something
    // that will actually compute rather than at a string someone typed.
    metrics: listMetrics(),
    hasGoals: modules.some((m) => m.id === 'goals'),
    todayIso,
    // The real hour, not a hardcoded "04:00": the cron fires at a fixed UTC
    // hour, which lands at a different local time in Chicago's summer and
    // winter, same as the Review pass computes it.
    nightlyAt: nightlyRunAt(settings.timezone),
    schedule: {
      morningEnabled: settings.digest_morning_enabled,
      eveningAt: settings.digest_evening_at,
      eveningEnabled: settings.digest_evening_enabled,
      quietFrom: settings.quiet_from,
      quietTo: settings.quiet_to,
      urgentOverride: settings.quiet_urgent_override,
    },
    completedAt: settings.onboarding_completed_at,
  }

  return <Onboarding data={data} />
}
