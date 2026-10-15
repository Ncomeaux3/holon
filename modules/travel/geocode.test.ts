import { afterEach, describe, expect, it, vi } from 'vitest'
import { geocode, toHits } from './geocode'

// Open-Meteo geocoding: toHits is pure parsing, geocode is the fetch wrapper
// that never throws (docs/research/open-meteo-geocoding.md).
describe('toHits', () => {
  it('builds a label with admin1', () => {
    expect(
      toHits({
        results: [{ name: 'Portland', latitude: 45.523, longitude: -122.676, country: 'United States', admin1: 'Oregon' }],
      }),
    ).toEqual([{ label: 'Portland, Oregon, United States', lat: 45.523, lon: -122.676 }])
  })

  it('omits admin1 from the label when absent', () => {
    expect(
      toHits({
        results: [{ name: 'Singapore', latitude: 1.3, longitude: 103.8, country: 'Singapore' }],
      }),
    ).toEqual([{ label: 'Singapore, Singapore', lat: 1.3, lon: 103.8 }])
  })

  it('drops a result missing coordinates', () => {
    expect(
      toHits({
        results: [
          { name: 'Nowhere', country: 'Nowhereland' },
          { name: 'Portland', latitude: 45.523, longitude: -122.676, country: 'United States', admin1: 'Oregon' },
        ],
      }),
    ).toEqual([{ label: 'Portland, Oregon, United States', lat: 45.523, lon: -122.676 }])
  })

  it('returns an empty list for anything without a results array', () => {
    expect(toHits({})).toEqual([])
    expect(toHits(null)).toEqual([])
  })
})

describe('geocode', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('makes no request for fewer than two characters', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await geocode('a')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns an empty list when the request rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down'))),
    )
    expect(await geocode('Portland')).toEqual([])
  })
})
