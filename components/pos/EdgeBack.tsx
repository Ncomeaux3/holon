'use client'

import { useEdgeBack } from './gestures'
import { goBack } from './PageTransition'
import { useIsPhone } from './useIsPhone'

/**
 * An installed PWA on iOS has no browser edge swipe, so the app owns it: a
 * drag from the left edge past 90px goes back, mirroring the header's back
 * control. Renders nothing; phone only.
 */
export function EdgeBack() {
  const phone = useIsPhone()
  useEdgeBack(phone ? goBack : null)
  return null
}
