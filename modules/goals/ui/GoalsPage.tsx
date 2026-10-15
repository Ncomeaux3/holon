import { Eyebrow, PageHeader } from '@/components/pos'
import { listMetrics } from '@/core/metrics'
import { getLinked, getSkillNames } from '@/core/modules'
import { listSkillLinks } from '@/core/skill-links'
import { ownerToday } from '@/core/today'
import { historyByGoal, listGoals, pendingProposals } from '../data'
import { progress, rule, type Goal as Shape, type Status } from '../progress'
import { GoalList, GoalsCrumb, NewGoalButton, type GoalCard } from './GoalList'

const days = (fromIso: string, toIso: string) =>
  Math.round(
    (new Date(`${toIso}T12:00:00`).getTime() - new Date(`${fromIso}T12:00:00`).getTime()) /
      86_400_000,
  )

export default async function GoalsPage() {
  const [rows, history, todayIso, links, names, proposals] = await Promise.all([
    listGoals(),
    historyByGoal(),
    ownerToday(),
    listSkillLinks('goals', 'goal'),
    getSkillNames(),
    pendingProposals(),
  ])

  // What other modules keep about each goal, through the registry: today that
  // is Tasks answering with the tasks whose goal_ref is the goal.
  const linked = new Map(
    await Promise.all(
      rows.map(async (row) => {
        const ref = links.get(row.id)?.entityRef
        return [row.id, ref ? await getLinked(ref) : []] as const
      }),
    ),
  )

  const cards: GoalCard[] = rows.map((row) => {
    const shape: Shape = {
      kind: row.kind,
      startValue: Number(row.start_value),
      targetValue: Number(row.target_value),
      deadlineInDays: days(todayIso, row.deadline),
      ageInDays: Math.max(
        1,
        days(new Date(row.created_at).toISOString().slice(0, 10), todayIso),
      ),
      history: history.get(row.id) ?? [],
    }
    const p = progress(shape)

    return {
      id: row.id,
      title: row.title,
      notes: row.notes,
      area: row.area,
      kind: row.kind,
      unit: row.unit,
      startValue: shape.startValue,
      targetValue: shape.targetValue,
      deadline: row.deadline,
      ageInDays: shape.ageInDays,
      metricSource: row.metric_source,
      archived: row.archived,
      history: shape.history,
      progress: p,
      rule: rule(shape, p, row.unit),
      tasks: linked.get(row.id) ?? [],
      entityRef: links.get(row.id)?.entityRef ?? null,
      skills: links.get(row.id)?.skills ?? [],
      proposals: proposals
        .filter((pr) => pr.goal_id === row.id)
        .map((pr) => ({ id: pr.id, from: `goals.${pr.tool}`, title: pr.title })),
    }
  })

  const live = cards.filter((c) => !c.archived)
  const count = (s: Status) => live.filter((c) => c.progress.status === s).length
  const atRisk = count('at_risk')
  const stalled = count('stalled')

  return (
    <div className="space-y-[18px]">
      <PageHeader
        eyebrow={<GoalsCrumb />}
        status={
          <Eyebrow
            dot={stalled > 0 ? 'bad' : atRisk > 0 ? 'warn' : 'ok'}
            className="whitespace-nowrap"
          >
            {live.length} active · {atRisk} at risk · {stalled} stalled
          </Eyebrow>
        }
        title="Goals"
        lede="Progress is computed from a metric when one exists, otherwise from check-ins. Status: at risk when pace is under 80% of what the deadline needs; stalled after 30 days without change."
        actions={<NewGoalButton />}
        phoneAction={<NewGoalButton />}
      />

      <GoalList
        goals={cards}
        // Enumerated from the manifests, so the picker offers exactly what some
        // module will actually compute and nothing else.
        metrics={listMetrics()}
        skills={Object.entries(names)}
        todayIso={todayIso}
      />
    </div>
  )
}
