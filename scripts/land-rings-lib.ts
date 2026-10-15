// The arithmetic behind scripts/land-rings.mts, kept apart so it can be tested
// without fetching anything.

type Topology = {
  transform: { scale: [number, number]; translate: [number, number] }
  arcs: number[][][]
  objects: Partial<Record<'land' | 'countries', { type: string; geometries?: unknown[]; arcs?: unknown }>>
}

/** A ring is a closed list of [lon, lat]. */
export type Ring = [number, number][]

/** Decodes the topology's delta-encoded, quantised arcs into absolute rings. */
export function decodeTopology(topo: Topology): Ring[] {
  const { scale, translate } = topo.transform
  const arcs = topo.arcs.map((arc) => {
    let x = 0
    let y = 0
    return arc.map(([dx, dy]) => {
      x += dx
      y += dy
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]] as [number, number]
    })
  })
  const object = topo.objects.countries ?? topo.objects.land
  if (!object) throw new Error('topology has neither countries nor land')
  const geometries: { type: string; arcs: unknown }[] = (object.geometries ?? [object]) as {
    type: string
    arcs: unknown
  }[]

  const ring = (indexes: number[]): Ring => {
    const out: Ring = []
    for (const i of indexes) {
      const arc = i < 0 ? [...arcs[~i]].reverse() : arcs[i]
      // Consecutive arcs share their end point.
      out.push(...(out.length > 0 ? arc.slice(1) : arc))
    }
    return out
  }

  const rings: Ring[] = []
  for (const g of geometries) {
    if (g.type === 'Polygon') for (const r of g.arcs as number[][]) rings.push(ring(r))
    if (g.type === 'MultiPolygon')
      for (const poly of g.arcs as number[][][]) for (const r of poly) rings.push(ring(r))
  }
  return rings
}

/**
 * Even-odd point in polygon over every ring: land polygons and their lake
 * holes both count, and a point inside an odd number of rings is on land.
 */
export function pointInRings(lat: number, lon: number, rings: Ring[]): boolean {
  let inside = false
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i]
      const [xj, yj] = r[j]
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}
