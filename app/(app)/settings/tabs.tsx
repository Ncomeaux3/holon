import { Eyebrow, PageHeader, TabLinks, type TabLink } from '@/components/pos'
import { getConnectionStatuses, getIntegrations } from '@/core/integrations'
import { getModule } from '@/core/modules'

// One list, imported by every settings route, so the tab row cannot drift
// between them.
//
// The Skills tab appears only while a module owns a skill tree, so deleting
// modules/skills leaves no link to a page that explains its own absence.
// skillCount is the number of skills; every page but Skills itself omits it and
// the tab renders without a count.
export function settingsTabs(providerCount: number, skillCount?: number): TabLink[] {
  return [
    { href: '/settings', label: 'General' },
    { href: '/settings/connections', label: 'Connections', count: providerCount },
    { href: '/settings/agents', label: 'Agents & MCP' },
    { href: '/settings/notifications', label: 'Notifications' },
    ...(getModule('skills')
      ? [{ href: '/settings/skills', label: 'Skills', count: skillCount } as TabLink]
      : []),
  ]
}

/**
 * The artboard's one header for every tab: the band with "{n} of {m}
 * connected", the title "Settings", its lede, and the tab row under it. The
 * tab is the crumb; the title does not change.
 */
export async function SettingsHeader({ current, skillCount }: { current: string; skillCount?: number }) {
  const manifests = getIntegrations()
  const statuses = await getConnectionStatuses()
  const connected = manifests.filter((m) => statuses[m.id]?.connected).length
  const tabs = settingsTabs(manifests.length, skillCount)
  const tab = tabs.find((t) => t.href === current)

  return (
    // A fragment: PageHeader's sticky bar holds only inside the page column.
    <>
      <PageHeader
        eyebrow={`Settings / ${typeof tab?.label === 'string' ? tab.label : 'General'}`}
        status={
          <Eyebrow dot={connected > 0 ? 'ok' : 'idle'} className="whitespace-nowrap">
            {connected} of {manifests.length} connected
          </Eyebrow>
        }
        title="Settings"
        lede="Owner preferences and every external account the system can reach. Credentials are encrypted at rest and never live in the repo."
      />
      <TabLinks tabs={tabs} current={current} label="Settings sections" />
    </>
  )
}
