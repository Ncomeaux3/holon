import type { BrainDigest } from '../jobs/nightly-digest'

// The Second Brain dashboard tile. The inbox is the thing that needs a person:
// a draft waits there until it is accepted, so it leads.

export function BrainTile({ payload }: { payload: Record<string, unknown> }) {
  const d = payload as Partial<BrainDigest>
  const inbox = d.inbox ?? 0

  return (
    <div className="space-y-3">
      <div>
        <span className="eyebrow block text-secondary-label">Waiting in the inbox</span>
        <span className="num block text-title-2 font-semibold text-label">{inbox}</span>
        <span className="num text-caption-1 text-secondary-label">
          {d.writtenThisWeek ?? 0} written this week
        </span>
      </div>
      <p className="num text-caption-1 text-secondary-label">
        {d.published ?? 0} published
        {d.uncommitted ? ` · ${d.uncommitted} not in the vault` : ''}
        {d.unresolved
          ? ` · ${d.unresolved} ${d.unresolved === 1 ? 'link' : 'links'} with nothing behind them`
          : ''}
      </p>
    </div>
  )
}
