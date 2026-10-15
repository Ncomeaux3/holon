// The six numbers at the top of the weekly review, as POS Weekly Review.dc.html
// draws them: Tasks closed, Slipped, Spend vs budget, Net worth, Workouts, XP
// earned. Pure: two digest snapshots in, tiles out. No imports, so the test
// needs no database and the wizard could render it client side if it had to.
//
// Core names the keys and the order here, which is the one place it does. A
// module writes its digest in its own shape; this reads the keys it recognises
// and draws nothing for a module that wrote no digest or a key that is not
// there. A delta line needs last week's row, so the first week after a deploy
// shows the number alone.

export type DigestMap = Record<string, Record<string, unknown>>

export type GlanceTile = {
  module: string
  label: string
  value: string
  delta: string | null
  tone: 'brand' | 'warn' | 'quiet'
}

type Attribute = { skillId: string; name: string; level: number }
type Gain = { skillId: string; name: string; gained: number }

const num = (payload: Record<string, unknown> | undefined, key: string): number | null => {
  const value = payload?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const int = (n: number) => Math.round(n).toLocaleString('en-US')
const dollars = (cents: number) => `$${int(cents / 100)}`
const signed = (n: number) => `${n > 0 ? '+' : ''}${int(n)}`

/** "+4 vs last week", coloured by whether up is the good direction. */
function versusLastWeek(
  value: number,
  was: number | null,
  good: 'up' | 'down',
): Pick<GlanceTile, 'delta' | 'tone'> {
  if (was === null) return { delta: null, tone: 'quiet' }
  const change = Math.round(value - was)
  if (change === 0) return { delta: 'no change vs last week', tone: 'quiet' }
  return {
    delta: `${signed(change)} vs last week`,
    tone: (change > 0) === (good === 'up') ? 'brand' : 'warn',
  }
}

export function glanceTiles(now: DigestMap, lastWeek: DigestMap): GlanceTile[] {
  const tiles: GlanceTile[] = []
  const tasks = now.tasks
  const finance = now.finance
  const fitness = now.fitness
  const skills = now.skills

  const closed = num(tasks, 'completedThisWeek')
  if (closed !== null) {
    tiles.push({
      module: 'tasks',
      label: 'Tasks closed',
      value: int(closed),
      ...versusLastWeek(closed, num(lastWeek.tasks, 'completedThisWeek'), 'up'),
    })
  }

  const overdue = num(tasks, 'overdue')
  if (overdue !== null) {
    const rolledTwice = num(tasks, 'rolledTwice') ?? 0
    tiles.push({
      module: 'tasks',
      label: 'Slipped',
      value: int(overdue),
      ...(rolledTwice > 0
        ? { delta: `${int(rolledTwice)} rolled twice`, tone: 'warn' as const }
        : versusLastWeek(overdue, num(lastWeek.tasks, 'overdue'), 'down')),
    })
  }

  const spend = num(finance, 'spendCents')
  const budget = num(finance, 'budgetCents')
  if (spend !== null && budget !== null && budget > 0) {
    const percent = Math.round((spend / budget) * 100)
    tiles.push({
      module: 'finance',
      label: 'Spend vs budget',
      value: `${percent}%`,
      delta: `${dollars(spend)} of ${dollars(budget)}`,
      tone: percent >= 100 ? 'warn' : 'brand',
    })
  }

  const netWorth = num(finance, 'netWorthCents')
  if (netWorth !== null) {
    const change = num(finance, 'changeCents') ?? 0
    const base = netWorth - change
    // An account opened this month has no base to measure against, so the
    // figure stands alone rather than claiming infinite growth.
    if (base > 0) {
      const percent = (change / base) * 100
      tiles.push({
        module: 'finance',
        label: 'Net worth',
        value: `${percent > 0 ? '+' : ''}${percent.toFixed(1)}%`,
        delta: dollars(netWorth),
        tone: change > 0 ? 'brand' : change < 0 ? 'warn' : 'quiet',
      })
    } else {
      tiles.push({ module: 'finance', label: 'Net worth', value: dollars(netWorth), delta: null, tone: 'quiet' })
    }
  }

  const workouts = num(fitness, 'workoutsThisWeek')
  if (workouts !== null) {
    const load = num(fitness, 'loadThisWeek')
    const loadWas = num(fitness, 'loadLastWeek')
    const diff = load !== null && loadWas !== null ? load - loadWas : null
    tiles.push({
      module: 'fitness',
      label: 'Workouts',
      value: int(workouts),
      delta: load === null ? null : diff === null ? `load ${int(load)}` : `load ${int(load)} · ${signed(diff)}`,
      // A lighter week is a deload as often as a lapse, so it is not a warning.
      tone: diff !== null && diff > 0 ? 'brand' : 'quiet',
    })
  }

  const xp = num(skills, 'xpThisWeek')
  if (xp !== null) {
    const levelsNow = (skills?.attributes as Attribute[] | undefined) ?? []
    const levelsWere = (lastWeek.skills?.attributes as Attribute[] | undefined) ?? []
    const levelUp = levelsNow.find((a) => {
      const was = levelsWere.find((b) => b.skillId === a.skillId)
      return was !== undefined && a.level > was.level
    })
    const top = ((skills?.gainedThisWeek as Gain[] | undefined) ?? [])[0]
    const delta = levelUp
      ? `${levelUp.name} → level ${levelUp.level}`
      : top && top.gained > 0
        ? `${top.name} +${int(top.gained)}`
        : null
    tiles.push({ module: 'skills', label: 'XP earned', value: int(xp), delta, tone: delta ? 'brand' : 'quiet' })
  }

  return tiles
}
