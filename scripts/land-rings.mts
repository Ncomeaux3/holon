// Decodes the world's countries as a list of rings, once, from Natural Earth's
// 110m countries topology (world-atlas@2, public domain). The output is
// committed as modules/travel/land.json and drawn by the hand-rolled globe as
// filled polygons, clipped at the horizon in modules/travel/globe.ts. Countries
// rather than land so that filling every ring and stroking it gives coastline
// and borders from one file and one path. Nothing here runs at build or in
// the browser: d3-geo, topojson and world-atlas stay out of the bundle, as
// decided on 2026-09-07.
//
//   pnpm exec tsx scripts/land-rings.mts [path-to-countries-110m.json]
//
// With no path it fetches https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json.

import { readFileSync, writeFileSync } from 'node:fs'
import { pointInRings, decodeTopology, type Ring } from './land-rings-lib'

const source = process.argv[2]
const text = source
  ? readFileSync(source, 'utf8')
  : await (await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json')).text()

// One decimal is about 11 km, coarser than the data itself, and halves the
// file. An islet that rounds to fewer than a closed triangle is dropped.
// Three rings (Fiji, Russia, Wrangel Island) cross the antimeridian uncut, so
// a longitude that jumps by more than 180 continues past 180 instead: the
// globe's projection is periodic and the flat map draws a copy either side.
const rings: Ring[] = decodeTopology(JSON.parse(text))
  .map((ring) => {
    const out: Ring = []
    let offset = 0
    let prev = ring[0][0]
    for (const [raw, lat] of ring) {
      if (raw - prev > 180) offset -= 360
      if (raw - prev < -180) offset += 360
      prev = raw
      const p: [number, number] = [Math.round((raw + offset) * 10) / 10, Math.round(lat * 10) / 10]
      const last = out[out.length - 1]
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
    }
    const [first, last] = [out[0], out[out.length - 1]]
    if (first[0] !== last[0] || first[1] !== last[1]) out.push(first)
    return out
  })
  .filter((ring) => ring.length >= 4)
const json = JSON.stringify(rings)
writeFileSync('modules/travel/land.json', json)
const vertices = rings.reduce((n, r) => n + r.length, 0)
console.log(`${rings.length} rings, ${vertices} vertices, ${json.length} bytes; Denver is land: ${pointInRings(39.7, -105, rings)}`)
