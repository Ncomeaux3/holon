import { Card, CardHead, Chip, Eyebrow, MetricTile, PageHeader, Row, RowList, StatusChip } from '@/components/pos'
import { getModule, getModules } from '@/core/modules'
import { getSetting } from '@/core/settings'
import { clockIn, dayIn } from '@/core/today'
import { listRuns, listUndone } from '@/core/writelog'
import { duration, summarise, type Entry, type Job, type Run } from '@/core/writelog-shape'
import { AutonomyPicker } from '../settings/agents/AutonomyPicker'
import { jobLabel } from './format'
import { RunLog } from './RunLog'
import { RunNow } from '../RunNow'
import { AgentLogTabs } from './tabs'

function label(id: string): string {
  if (id === 'system') return 'System'
  return getModule(id)?.nav.label ?? id[0].toUpperCase() + id.slice(1)
}

export default async function AgentLogPage() {
  const [{ runs, entries }, undone, autonomy, timezone] = await Promise.all([
    listRuns(),
    listUndone(),
    getSetting('agent_autonomy'),
    getSetting('timezone'),
  ])

  // In the owner's timezone, not the server's. On Vercel the server is UTC, so
  // a run at 19:34 in Chicago rendered as 00:34 the following day and the log
  // showed tomorrow's date all evening.
  const clock = (at: Date) => clockIn(new Date(at), timezone)
  const day = (at: Date) => dayIn(new Date(at), timezone)

  const shaped: Run[] = runs.map((r) => {
    const jobs: Job[] = r.log.jobs ?? []
    const mine: Entry[] = entries
      .filter((e) => e.run_id === r.id)
      .map((e) => ({
        id: e.id,
        module: e.module,
        moduleLabel: label(e.module),
        tool: e.tool,
        kind: e.kind.charAt(0).toUpperCase() + e.kind.slice(1),
        title: e.title,
        reason: e.reason,
        diff: e.diff,
        time: clock(e.created_at),
        undone: e.undone_at !== null,
        canUndo: e.can_undo,
        canRedo: e.can_redo,
      }))

    return {
      id: r.id,
      date: day(r.started_at),
      clock: clock(r.started_at),
      duration: duration(r.duration_ms),
      status: (r.status as Run['status']) ?? 'clean',
      summary: summarise(mine, jobs),
      writes: mine.length,
      jobs,
      entries: mine,
    }
  })

  // The rail describes the same run the accordion opens on, or there are two
  // different runs on screen both called "this one".
  const last = shaped.find((r) => r.entries.length > 0) ?? shaped[0]
  const failures = last?.jobs.filter((j) => j.status === 'failed').length ?? 0
  const reverted = last?.entries.filter((e) => e.undone).length ?? 0

  const moduleLabels = Object.fromEntries(
    [...new Set(entries.map((e) => e.module))].map((id) => [id, label(id)]),
  )

  // Nav order, not first-seen order, so the filter row reads the way the
  // sidebar does. Doubles as the set of modules a failed job can honestly
  // retry: `runNightly({ module })` only knows the ids in this list, and a
  // job stamped with anything else (a core stage, for instance) would rerun
  // nothing at all if a button pretended otherwise.
  const registeredModules = getModules().map((m) => m.id)

  const writeWord = (n: number) => `write${n === 1 ? '' : 's'}`
  const jobWord = (n: number) => `job${n === 1 ? '' : 's'}`

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={
          last
            ? `Last run ${last.date} ${last.clock} · ${last.writes} ${writeWord(last.writes)} · ${failures} ${jobWord(failures)} failed`
            : 'No run yet'
        }
        dot={!last ? 'idle' : failures > 0 ? 'warn' : 'ok'}
        title="What the agent did while you slept"
        lede="Every write is logged with the value before and after. Undo restores the previous value and pauses the rule that produced it for seven days."
        actions={<RunNow />}
      />

      <AgentLogTabs current="/agent-log" />

      <div className="flex flex-wrap items-start gap-x-8 gap-y-7">
        <div className="min-w-0 flex-[1_1_520px]">
          <RunLog runs={shaped} moduleLabels={moduleLabels} registeredModules={registeredModules} />
        </div>

        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-6 xl:max-w-[400px]">
          <section className="space-y-3">
            <Eyebrow>{last ? 'This run' : 'No run yet'}</Eyebrow>
            <div className="grid grid-cols-2 gap-2.5">
              <MetricTile label="Writes" value={last?.writes ?? 0} />
              <MetricTile
                label="Reverted"
                value={reverted}
                delta={reverted > 0 ? 'put back' : undefined}
                deltaTone="warn"
              />
              <MetricTile label="Duration" value={last?.duration ?? '--'} />
              <MetricTile
                label="Failures"
                value={failures}
                delta={failures > 0 ? 'see the run' : undefined}
                deltaTone="warn"
              />
            </div>
          </section>

          <section className="space-y-3">
            <Eyebrow>Jobs</Eyebrow>
            {last && last.jobs.length > 0 ? (
              <>
                <RowList>
                  {last.jobs.map((j) => (
                    <Row
                      key={`${j.module}.${j.name}`}
                      title={`${label(j.module)} / ${jobLabel(j.name)}`}
                      amount={duration(j.durationMs)}
                      right={
                        <StatusChip tone={j.status === 'ok' ? 'brand' : 'bad'}>
                          {j.status === 'ok' ? 'Ok' : 'Failed'}
                        </StatusChip>
                      }
                    />
                  ))}
                </RowList>
                <p className="text-footnote text-secondary-label">
                  A failed job retries twice inside the same run, then waits for the next one.
                </p>
              </>
            ) : (
              <p className="text-footnote text-secondary-label">
                No jobs recorded yet. The nightly cron writes one row per invocation.
              </p>
            )}
          </section>

          <section className="space-y-3">
            <Eyebrow>Undo history / {undone.length}</Eyebrow>
            {undone.length === 0 ? (
              <p className="text-footnote text-secondary-label">
                Nothing reverted yet. Undo an entry and it lands here, with the rule that produced it
                paused for seven days.
              </p>
            ) : (
              <div className="[&>*:last-child]:border-b-0">
                {undone.map((u) => (
                  <div key={u.id} className="space-y-1 border-b border-separator py-3">
                    <div className="flex items-baseline justify-between gap-2.5">
                      <Chip tone="warn">Reverted</Chip>
                      <span className="text-footnote num text-secondary-label">
                        {day(u.undone_at)} {clock(u.undone_at)}
                      </span>
                    </div>
                    <p className="text-footnote text-label">{u.title}</p>
                    <p className="text-footnote text-secondary-label">
                      {label(u.module)}
                      {u.rule_paused ? ' / rule paused 7 days' : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <Card className="space-y-3">
            <CardHead label="Autonomy" />
            <p className="text-footnote text-secondary-label">
              {autonomy === 'observe'
                ? 'The agent reads and reports. Nothing is written without you doing it by hand.'
                : autonomy === 'propose'
                  ? 'Low risk writes happen directly. Anything that moves money, deletes, or merges goes to Review first.'
                  : 'The agent writes everything it is confident about and logs it here. Undo is always one press.'}
            </p>
            <AutonomyPicker value={autonomy} />
          </Card>
        </aside>
      </div>
    </div>
  )
}
