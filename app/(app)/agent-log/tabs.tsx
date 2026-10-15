import { TabLinks } from '@/components/pos'

// One list for both Agent log routes, so the tab row cannot drift between
// them, the way settings/tabs.tsx does it.
export function AgentLogTabs({ current }: { current: '/agent-log' | '/agent-log/errors' }) {
  return (
    <TabLinks
      label="Agent log sections"
      current={current}
      tabs={[
        { href: '/agent-log', label: 'Log' },
        { href: '/agent-log/errors', label: 'Errors' },
      ]}
    />
  )
}
