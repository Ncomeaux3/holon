import { NextResponse } from 'next/server'
import { requireOwner } from '@/core/auth'
import { withLog } from '@/core/log'
import { searchFoods, UsdaError } from '@/integrations/usda/client'

// USDA matches for an ingredient in the recipe form. A GET and not a server
// action, for the reason app/api/travel/places is one: actions run one at a
// time, and a slow USDA call would hold the recipe's Save behind it.
export const maxDuration = 10

async function handle(request: Request) {
  await requireOwner()
  const q = new URL(request.url).searchParams.get('q')?.trim().slice(0, 200) ?? ''
  if (q.length < 2) return NextResponse.json({ foods: [] })
  try {
    return NextResponse.json({ foods: await searchFoods(q) })
  } catch (error) {
    // Not connected, a refused key or the hour's limit: the form says which,
    // and the ingredient saves without a match.
    if (error instanceof UsdaError) return NextResponse.json({ foods: [], error: error.message })
    throw error
  }
}

export const GET = withLog(handle)
