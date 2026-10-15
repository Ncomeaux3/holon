import { db } from '@/core/db'
import { register } from '@/core/entities'

// Synthetic rows for `pnpm setup --demo`. Upserts on external_id so running it
// twice does not duplicate. Nothing here is personal; this ships in the template.
//
// One idea in each quadrant and one in each stage, including a killed one with
// its reason, so the board shows what it is for rather than a single column.

const IDEAS: {
  external_id: string
  title: string
  pitch: string
  stage: 'exploring' | 'validated' | 'building' | 'killed'
  effort: 1 | 2 | 3
  impact: 1 | 2 | 3
  killedReason?: string
  staleDays?: number
  tags?: string[]
}[] = [
  { external_id: 'i-import', tags: ['pos', 'import'], title: 'One click Notion import', pitch: 'Read an export and fill every module at once.', stage: 'building', effort: 2, impact: 3 },
  { external_id: 'i-digest', tags: ['pos', 'email', 'digest'], title: 'Weekly digest as a printable page', pitch: 'One sheet for the fridge.', stage: 'validated', effort: 1, impact: 2 },
  { external_id: 'i-share', tags: ['pos', 'share'], title: 'Share a read only dashboard link', pitch: 'For a partner or an accountant.', stage: 'exploring', effort: 3, impact: 2 },
  { external_id: 'i-voice', tags: ['mobile', 'capture', 'voice'], title: 'Voice capture for tasks', pitch: 'Speak a task on a walk.', stage: 'exploring', effort: 1, impact: 3 },
  { external_id: 'i-theme', tags: ['pos', 'growth'], title: 'Per module colour themes', pitch: 'Cosmetic only.', stage: 'exploring', effort: 3, impact: 1 },
  // Sitting in Exploring long enough to read STALE on its card.
  { external_id: 'i-stale', tags: ['brain', 'capture'], title: 'Browser extension for clipping', pitch: 'Save a page to the Second Brain inbox.', stage: 'exploring', effort: 2, impact: 2, staleDays: 95 },
  { external_id: 'i-crypto', tags: ['finance', 'crypto'], title: 'Automatic crypto tax lots', pitch: 'Track cost basis across exchanges.', stage: 'killed', effort: 3, impact: 1, killedReason: 'Every exchange exports differently and none of it reconciles.' },
]

export async function seed(): Promise<number> {
  for (const idea of IDEAS) {
    const { rows } = await db().query<{ id: string }>(
      `insert into ideas.idea
         (title, pitch, stage, effort, impact, killed_reason, source, external_id, updated_at,
          stage_since, tags)
       values ($1, $2, $3, $4, $5, $6, 'demo', $7,
               now() - ($8::int || ' days')::interval,
               now() - ($8::int || ' days')::interval, $9)
       on conflict (source, external_id) do update
         set stage = excluded.stage, effort = excluded.effort, impact = excluded.impact,
             killed_reason = excluded.killed_reason, updated_at = excluded.updated_at,
             stage_since = excluded.stage_since, tags = excluded.tags
       returning id`,
      [
        idea.title,
        idea.pitch,
        idea.stage,
        idea.effort,
        idea.impact,
        idea.killedReason ?? '',
        idea.external_id,
        idea.staleDays ?? 1,
        idea.tags ?? [],
      ],
    )

    await register({
      module: 'ideas',
      entityType: 'idea',
      entityId: rows[0].id,
      title: idea.title,
      text: idea.pitch,
      eventType: idea.stage === 'building' ? 'idea_building' : 'idea_captured',
      replace: true,
    })
  }

  // One synthetic research report, so the panel and its rules are visible
  // without spending anything. Every claim here cites a source in the list
  // below it, which is the rule the real job enforces before it writes a row.
  // The numbers and the URLs are invented, like the rest of this file.
  const { rows: target } = await db().query<{ id: string }>(
    `select id from ideas.idea where source = 'demo' and external_id = 'i-share'`,
  )
  if (target[0]) {
    await db().query(`delete from ideas.research where idea_id = $1`, [target[0].id])
    await db().query(
      `insert into ideas.research
         (idea_id, depth, status, verdict, confidence, sections, sources, searches,
          cost_cents, model)
       values ($1, 'quick', 'ok', 'park', 0.55, $2::jsonb, $3::jsonb, 4, 5.8,
               'claude-sonnet-5')`,
      [
        target[0].id,
        JSON.stringify([
          {
            key: 'problem',
            label: 'Problem',
            summary:
              'People who track their own money want to show one number to a partner or an accountant without handing over the whole system.',
            claims: [],
          },
          {
            key: 'market',
            label: 'Market',
            summary: 'Small, and mostly people who already build their own tools.',
            claims: [
              {
                text: 'Personal finance tools with a sharing feature charge between 5 and 15 dollars a month',
                source: 'https://example.com/personal-finance-pricing',
              },
            ],
          },
          {
            key: 'competitors',
            label: 'Competitors',
            summary: 'Every hosted budgeting app has this. No self hosted one does it well.',
            claims: [],
          },
          {
            key: 'differentiation',
            label: 'Differentiation',
            summary:
              'A link that expires and shows one page, rather than an account with a login and a permission model.',
            claims: [],
          },
          {
            key: 'feasibility',
            label: 'Feasibility for a solo builder',
            summary:
              'A signed URL, a read only page, and an expiry. The hard part is not the link, it is deciding what a viewer may see.',
            claims: [],
          },
        ]),
        JSON.stringify([
          {
            url: 'https://example.com/personal-finance-pricing',
            title: 'What personal finance tools charge',
            citedText: 'Plans range from $5 to $15 per month for shared access.',
          },
        ]),
      ],
    )
  }

  return IDEAS.length
}
