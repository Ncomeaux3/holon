import { NextResponse } from 'next/server'
import { requireOwner } from '@/core/auth'
import { withLog } from '@/core/log'
import { geocode } from '@/modules/travel/geocode'

// Destination suggestions while typing. A GET and not a server action: Next
// runs a page's server actions one at a time, so a search waiting on a slow or
// unreachable geocoder (up to its 5 s timeout) held every save behind it, and
// three destinations typed meant Create waited fifteen seconds.
export const maxDuration = 10

async function handle(request: Request) {
  // proxy.ts already turns away a visitor without the owner cookie; this is
  // the same backstop the other routes keep.
  await requireOwner()
  const q = new URL(request.url).searchParams.get('q')?.slice(0, 200) ?? ''
  return NextResponse.json(await geocode(q))
}

export const GET = withLog(handle)
