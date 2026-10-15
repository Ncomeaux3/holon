import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

/**
 * level = min(99, floor(sqrt(xp / 100))). Mirrored exactly by skills.level() in
 * SQL; core/xp.test.ts proves the two agree on a spread of values. Keep it
 * simple and visible: this is an ordinal judgement, not a measurement.
 */
export function level(xp: number): number {
  return Math.min(99, Math.floor(Math.sqrt(Math.max(xp, 0) / 100)))
}

let weights: Record<string, number> | undefined

/** XP per event type from modules/skills/xp.yaml. An absent type contributes nothing. */
export function loadWeights(): Record<string, number> {
  weights ??= parse(readFileSync(join(process.cwd(), 'modules/skills/xp.yaml'), 'utf8')).weights ?? {}
  return weights!
}
