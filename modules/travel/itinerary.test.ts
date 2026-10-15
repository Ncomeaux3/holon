import { describe, expect, it } from 'vitest'
import { guessKind, placesFor, reservationPath, tripDays } from './itinerary'

// The itinerary is drawn one section per day, each under the city it is in.

const cities = [
  { name: 'Ghent', startsOn: '2026-05-11', endsOn: '2026-05-16' },
  { name: 'Bruges', startsOn: '2026-05-16', endsOn: '2026-05-19' },
  { name: 'Antwerp', startsOn: '2026-05-19', endsOn: '2026-05-23' },
]

describe('tripDays', () => {
  it('lists every day from the first to the last, across a month end', () => {
    const days = tripDays('2026-09-29', '2026-10-02')
    expect(days).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
  })

  it('is one day for a trip with no end, and none for a trip with no start', () => {
    expect(tripDays('2026-09-29', null)).toEqual(['2026-09-29'])
    expect(tripDays(null, null)).toEqual([])
  })

  it('stays the same length across a daylight saving change', () => {
    // Europe falls back on 2026-10-25; a day that is 25 hours long must not
    // drop or repeat a date.
    expect(tripDays('2026-10-24', '2026-10-27')).toHaveLength(4)
  })
})

describe('placesFor', () => {
  it('is the destination whose dates cover the day', () => {
    expect(placesFor('2026-05-13', cities)).toEqual(['Ghent'])
    expect(placesFor('2026-05-21', cities)).toEqual(['Antwerp'])
  })

  it('is both cities on a travel day, in the order they are visited', () => {
    expect(placesFor('2026-05-16', cities)).toEqual(['Ghent', 'Bruges'])
  })

  it('is nothing for a day no destination covers, or a destination with no dates', () => {
    expect(placesFor('2026-05-27', cities)).toEqual([])
    expect(placesFor('2026-05-13', [{ name: 'Somewhere', startsOn: null, endsOn: null }])).toEqual([])
  })
})

describe('guessKind', () => {
  it('reads the obvious kinds from a title and calls the rest an activity', () => {
    expect(guessKind('SN 2401 BRU → AMS')).toBe('flight')
    expect(guessKind('Check in, Hotel Rubens')).toBe('lodging')
    expect(guessKind('Train to Bruges')).toBe('transit')
    expect(guessKind('Dinner at Pakhuis')).toBe('food')
    expect(guessKind('Gravensteen')).toBe('activity')
  })
})

describe('reservationPath', () => {
  const trip = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'
  const pdf = { name: 'Hotel Sacher (1).pdf', type: 'application/pdf', size: 120_000 }

  it("puts the file under the trip's own id with a safe name", () => {
    expect(reservationPath(trip, pdf, 1700000000000)).toBe(`${trip}/1700000000000-Hotel_Sacher__1_.pdf`)
    expect(reservationPath(trip, { ...pdf, type: 'image/jpeg' }, 1)).toMatch(new RegExp(`^${trip}/`))
  })

  it('refuses a trip id that is not one, a file that is not a PDF or a raster image, and one over 4 MB', () => {
    expect(() => reservationPath('../other', pdf)).toThrow('No such trip')
    expect(() => reservationPath(trip, { ...pdf, type: 'text/html' })).toThrow('PDF or an image')
    expect(() => reservationPath(trip, { ...pdf, type: 'image/svg+xml' })).toThrow('PDF or an image')
    expect(() => reservationPath(trip, { ...pdf, size: 5 * 1024 * 1024 })).toThrow('over 4 MB')
  })
})
