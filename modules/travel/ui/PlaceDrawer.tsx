'use client'

import { MetricStrip, MetricTile, Overlay } from '@/components/pos'
import type { TravelData } from './Travel'

// A grey pin whose trip is gone, or never was: the place as itself. Every
// pin with a trip opens that trip instead, so this only shows what the row
// holds and edits nothing.

export function PlaceDrawer({ place, onClose }: { place: TravelData['places'][number]; onClose: () => void }) {
  const visited = place.visitedOn
    ? new Date(`${place.visitedOn}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'no date'
  return (
    <Overlay open onClose={onClose} eyebrow="Travel / Places" title={place.name} lede={place.country || undefined} narrow>
      <MetricStrip>
        <MetricTile size="sm" label="Visited" value={visited} />
        <MetricTile size="sm" label="Where" value={`${place.lat.toFixed(2)}, ${place.lon.toFixed(2)}`} />
      </MetricStrip>
      <p className="mt-3.5 text-footnote text-secondary-label">This place is not part of a trip.</p>
    </Overlay>
  )
}
