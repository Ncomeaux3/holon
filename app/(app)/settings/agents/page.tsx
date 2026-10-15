import { Card, Eyebrow, StatusChip } from '@/components/pos'
import { guardedToolNames, listTools } from '@/core/mcp'
import { getOrigin } from '@/core/origin'
import { getSetting } from '@/core/settings'
import { AUTONOMY_LABELS, AUTONOMY_LEVELS, type Autonomy } from '@/core/autonomy'
import { SettingsHeader } from '../tabs'
import { AutonomyPicker } from './AutonomyPicker'
import { McpCommand } from './McpCommand'
import { revealMcpToken } from './actions'

const isRead = (name: string) =>
  name.endsWith('.get_digest') || name.endsWith('.query') || name === 'core.search'

export default async function AgentsPage() {
  const [origin, autonomy] = await Promise.all([getOrigin(), getSetting('agent_autonomy')])
  const tools = listTools()
  const guarded = new Set(guardedToolNames())
  const writes = tools.filter((t) => !isRead(t.name))

  return (
    <div className="space-y-[18px]">
      <SettingsHeader current="/settings/agents" />

      <div className="flex max-w-[720px] flex-col gap-3.5">
        <Card>
          <div className="flex items-center justify-between gap-3">
            <Eyebrow>MCP endpoint</Eyebrow>
            <Eyebrow dot="ok" className="text-green-text">
              Live · {tools.length} tools
            </Eyebrow>
          </div>
          <McpCommand origin={origin} reveal={revealMcpToken} />
          <p className="mt-3 text-footnote leading-[1.5] text-secondary-label">
            Set as MCP_TOKEN in .env, which is where infrastructure secrets live. Rotating it means
            changing that value and restarting, or updating the environment variable in Vercel and
            redeploying; the app cannot write its own .env.
          </p>
        </Card>

        <Card>
          <Eyebrow>Autonomy</Eyebrow>
          <p className="mt-2 text-footnote leading-[1.5] text-secondary-label">
            How much an agent may do without asking. A write you make in this app is never held
            back, at any level: pressing a button in your own app is the approval.
          </p>
          <div className="mt-3">
            <AutonomyPicker value={autonomy as Autonomy} />
          </div>
          <div className="mt-3">
            {AUTONOMY_LEVELS.map((level) => (
              <div key={level} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 border-b border-separator py-[9px] text-footnote last:border-b-0">
                <span className="text-label">{AUTONOMY_LABELS[level]}</span>
                <span className="text-footnote text-secondary-label">
                  {level === 'observe'
                    ? 'Everything an agent does becomes a proposal, including tools no module guarded.'
                    : level === 'propose'
                      ? 'Each module decides. Money, policy and goal writes propose; the rest run.'
                      : 'Nothing is held back. Every write is still logged with its before value, so the Agent Log can undo it.'}
                </span>
                <span className="justify-self-end">
                  {level === autonomy && <StatusChip tone="ok">Current</StatusChip>}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <Eyebrow>Guarded tools · agent writes go to Review</Eyebrow>
          <div className="mt-2">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-separator py-[9px] text-footnote md:grid-cols-[auto_minmax(0,1fr)_auto]">
              <span className="num text-footnote text-label">*.get_digest · *.query · core.search</span>
              <span className="order-last col-span-2 text-footnote text-secondary-label md:order-none md:col-span-1">Read-only, 5s timeout, 500 rows</span>
              <StatusChip tone="ok">Open</StatusChip>
            </div>
            {writes.map((t) => (
              <div key={t.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-separator py-[9px] text-footnote last:border-b-0 md:grid-cols-[auto_minmax(0,1fr)_auto]">
                <span className="num text-footnote text-label">{t.name}</span>
                <span className="order-last col-span-2 min-w-0 text-footnote text-secondary-label md:order-none md:col-span-1">
                  {t.description.replace(/ Guarded: this lands in the review inbox instead of writing\.$/, '')}
                </span>
                {guarded.has(t.name) ? (
                  <StatusChip tone="warn">Guarded</StatusChip>
                ) : (
                  <StatusChip tone="ok">Open</StatusChip>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
