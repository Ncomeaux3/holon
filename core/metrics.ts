import { recordError } from './log'
import { getModules } from './modules'

// The registry Goals reads. A module says what it can compute; nothing else in
// core knows what any of those numbers mean.

export type Metric = {
  /** `<module>.<key>`, which is what a goal stores. */
  id: string
  module: string
  label: string
  unit: string
}

export function listMetrics(): Metric[] {
  return getModules().flatMap((m) =>
    Object.entries(m.metrics ?? {}).map(([key, metric]) => ({
      id: `${m.id}.${key}`,
      module: m.id,
      label: metric.label,
      unit: metric.unit,
    })),
  )
}

/**
 * Run one metric, or null if nothing provides it any more.
 *
 * Null rather than a throw: a goal outlives the module it was pointed at, and
 * deleting a module folder has to leave a working app. The goal falls back to
 * its manual check-ins and the screen says the source is gone.
 */
export async function readMetric(id: string): Promise<number | null> {
  const [moduleId, ...rest] = id.split('.')
  const key = rest.join('.')

  const metric = getModules().find((m) => m.id === moduleId)?.metrics?.[key]
  if (!metric) return null

  try {
    return await metric.get()
  } catch (error) {
    // A metric that cannot compute is not a crash. The goal keeps its last
    // check-in; the failure goes to the Errors tab so it is not silent.
    await recordError(`metric:${id}`, error)
    return null
  }
}
