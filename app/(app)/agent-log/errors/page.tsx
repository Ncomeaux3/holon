import { Copy, EmptyState, Eyebrow, PageHeader, Row, RowList, TabLinks } from '@/components/pos'
import { copyText, listErrors, RANGES, type ErrorRow, type Range } from '@/core/errors'
import { getModule, getModules } from '@/core/modules'
import { getSetting } from '@/core/settings'
import { clockIn, dayIn } from '@/core/today'
import { AgentLogTabs } from '../tabs'

// Every failure the app recorded, in one place, without a trip to the Vercel
// logs (v1.2 Phase 2). Three sections read three existing records: the
// request log at 400 and above, the failed jobs inside partial and failed
// runs, and what the error boundaries posted from the browser. The filters
// are links, so the page is one server render and the URL is the state.

function label(id: string): string {
  if (id === 'system') return 'System'
  return getModule(id)?.nav.label ?? id[0].toUpperCase() + id.slice(1)
}

const isRange = (v: unknown): v is Range => typeof v === 'string' && v in RANGES

export default async function ErrorsPage({ searchParams }: PageProps<'/agent-log/errors'>) {
  const params = await searchParams
  const range: Range = isRange(params.range) ? params.range : '7d'
  // `module` is a name Next's lint reserves for the CommonJS one.
  const mod = typeof params.module === 'string' && params.module ? params.module : undefined

  const [errors, timezone] = await Promise.all([
    listErrors({ range, known: getModules().map((m) => m.id), module: mod }),
    getSetting('timezone'),
  ])

  // In the owner's timezone, the way the Log tab does it.
  const when = (at: Date) => `${dayIn(new Date(at), timezone)} ${clockIn(new Date(at), timezone)}`
  const href = (next: { range?: Range; module?: string }) => {
    const q = new URLSearchParams()
    const r = next.range ?? range
    const m = 'module' in next ? next.module : mod
    if (r !== '7d') q.set('range', r)
    if (m) q.set('module', m)
    const s = q.toString()
    return `/agent-log/errors${s ? `?${s}` : ''}`
  }

  const total = errors.requests.length + errors.jobs.length + errors.client.length

  const section = (eyebrow: string, rows: ErrorRow[], empty: string) => (
    <section className="space-y-3">
      <Eyebrow>
        {eyebrow} / {rows.length}
      </Eyebrow>
      {rows.length === 0 ? (
        <p className="text-footnote text-secondary-label">{empty}</p>
      ) : (
        <RowList>
          {rows.map((r) => (
            <Row
              key={r.id}
              title={<span className="num break-all">{r.where}</span>}
              meta={
                <>
                  <span className="break-words">{r.text}</span>
                  {r.digest && <span className="num"> · digest {r.digest}</span>}
                </>
              }
              date={<span className="whitespace-nowrap">{when(r.at)}</span>}
              right={<Copy value={copyText({ where: r.where, when: when(r.at), text: r.text })} label={`Copy ${r.where}`} />}
            >
              {r.stack && (
                <details>
                  <summary className="text-footnote inline-flex min-h-11 min-w-11 cursor-pointer items-center text-secondary-label hover:text-label">
                    Stack
                  </summary>
                  <pre className="text-footnote mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all text-secondary-label">{r.stack}</pre>
                </details>
              )}
            </Row>
          ))}
        </RowList>
      )}
    </section>
  )

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={`${total} ${total === 1 ? 'error' : 'errors'} · last ${RANGES[range]}`}
        dot={total === 0 ? 'ok' : 'warn'}
        title="What broke"
        lede="Failed requests, failed jobs and browser errors, each with a Copy button so the text can be pasted into a fix. Requests keep 90 days, browser errors 30."
      />

      <AgentLogTabs current="/agent-log/errors" />

      <div className="flex flex-wrap items-start gap-3">
        <TabLinks
          label="Time range"
          current={href({ range })}
          tabs={(Object.keys(RANGES) as Range[]).map((r) => ({ href: href({ range: r }), label: r }))}
        />
        {errors.modules.length > 0 && (
          <TabLinks
            label="Errors by module"
            current={href({ module: mod })}
            tabs={[
              { href: href({ module: undefined }), label: 'All' },
              ...errors.modules.map((m) => ({ href: href({ module: m }), label: label(m) })),
            ]}
          />
        )}
      </div>

      {total === 0 ? (
        <EmptyState headline="Nothing broke">
          No failed request, failed job or browser error in the last {RANGES[range]}
          {mod ? ` for ${label(mod)}` : ''}.
        </EmptyState>
      ) : (
        <div className="space-y-7">
          {section('Requests', errors.requests, `No request came back 400 or above in the last ${RANGES[range]}.`)}
          {section('Jobs', errors.jobs, `No job failed in the last ${RANGES[range]}.`)}
          {section('Client', errors.client, `No page failed to render in the last ${RANGES[range]}.`)}
        </div>
      )}
    </div>
  )
}
