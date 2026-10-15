import type { IdeasDigest } from '../jobs/nightly-digest'

// The Ideas dashboard tile. Quick wins, because the module exists to help the
// owner drop things rather than collect them.

export function IdeasTile({ payload }: { payload: Record<string, unknown> }) {
  const d = payload as Partial<IdeasDigest>
  const wins = d.quickWins ?? []
  const stale = d.stale ?? []
  const stages = Object.entries(d.byStage ?? {}).filter(([, n]) => Number(n) > 0)

  return (
    <div className="space-y-2.5">
      {wins.length === 0 ? (
        <p className="text-footnote text-secondary-label">No quick wins waiting.</p>
      ) : (
        wins.slice(0, 3).map((i) => (
          <div key={i.id} className="text-subheadline text-label">
            {i.title}
          </div>
        ))
      )}
      <p className="num text-caption-1 text-secondary-label">
        {stages.map(([stage, n]) => `${n} ${stage}`).join(' · ')}
        {stale.length > 0 ? ` · ${stale.length} gone quiet` : ''}
      </p>
    </div>
  )
}
