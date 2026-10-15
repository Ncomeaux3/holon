import { Eyebrow, PageHeader } from '@/components/pos'
import { getModule } from '@/core/modules'
import { listProposals, type Proposal, type ProposalStatus } from '@/core/proposals'
import { getSettings } from '@/core/settings'
import { clockIn } from '@/core/today'
import { ReviewList, type ReviewItem } from './ReviewList'
import { ReviewTabs } from './ReviewTabs'
import { ApproveAll } from './ApproveAll'

// The three the screen shows. 'rejected' is a fourth stored status kept for
// rows decided before dismissal existed; it has no tab and nothing writes it.
type ReviewTab = Extract<ProposalStatus, 'pending' | 'approved' | 'dismissed'>

const TABS: ReviewTab[] = ['pending', 'approved', 'dismissed']

function isTab(value: unknown): value is ReviewTab {
  return typeof value === 'string' && (TABS as string[]).includes(value)
}

/** "04:02 today", "yesterday", "2 days ago", on the owner's calendar. */
function when(at: Date, now: Date, timeZone: string): string {
  const ymd = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const days = Math.round((Date.parse(ymd(now)) - Date.parse(ymd(at))) / 86_400_000)
  if (days <= 0) return `${clockIn(at, timeZone)} today`
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function toItem(p: Proposal, now: Date, timeZone: string): ReviewItem {
  return {
    id: p.id,
    module: p.module,
    moduleLabel: getModule(p.module)?.nav.label ?? p.module,
    tool: p.tool,
    title: p.title ?? `${p.module}.${p.tool}`,
    agent: p.agent ?? 'agent',
    reason: p.reason ?? 'No reason given.',
    confidence: p.confidence === null ? null : Number(p.confidence),
    evidence: p.evidence,
    affects: p.affects,
    guarded: p.guarded,
    // An edit is a patch of the payload key the entry names, re-validated by
    // the tool's schema on approve. An entry naming anything else would be
    // dropped by that schema without a word, so it is not offered for edit.
    diff: p.diff.map((d) => ({ ...d, editable: d.field in p.payload })),
    status: p.status,
    when: when(p.createdAt, now, timeZone),
  }
}

export default async function ReviewPage({ searchParams }: PageProps<'/review'>) {
  const params = await searchParams
  const status: ReviewTab = isTab(params.tab) ? params.tab : 'pending'
  const sel = typeof params.sel === 'string' ? params.sel : null

  const [pending, approved, dismissed, settings] = await Promise.all([
    listProposals('pending'),
    listProposals('approved'),
    listProposals('dismissed'),
    getSettings(),
  ])

  const now = new Date()
  const byStatus = { pending, approved, dismissed }
  const items = byStatus[status].map((p) => toItem(p, now, settings.timezone))
  const unguarded = pending.filter((p) => !p.guarded).length
  const label = status[0].toUpperCase() + status.slice(1)
  // The nightly cron is 0 9 * * * UTC (vercel.json); the inbox says when that
  // is on the owner's clock.
  const nightly = clockIn(new Date(new Date().setUTCHours(9, 0, 0, 0)), settings.timezone)

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            Review <span className="text-secondary-label">/</span> {label}
          </>
        }
        title="Review"
        lede="Everything an agent wants to change. Nothing here touches your data until you approve it."
        status={<Eyebrow dot={pending.length > 0 ? 'warn' : 'ok'}>{pending.length} pending</Eyebrow>}
        actions={unguarded > 0 && <ApproveAll count={unguarded} />}
        // Shorter on the phone, where the long form clipped the h1 at 360.
        phoneAction={unguarded > 0 && <ApproveAll count={unguarded} short />}
      />

      <ReviewTabs
        className="mt-[18px]"
        value={status}
        tabs={TABS.map((t) => ({
          value: t,
          label: t[0].toUpperCase() + t.slice(1),
          count: byStatus[t].length,
        }))}
      />

      <ReviewList items={items} status={status} sel={sel} nightly={nightly} />
    </div>
  )
}
