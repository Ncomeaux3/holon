import { describe, expect, it } from 'vitest'
import { itineraryItems, tripDayItems } from './calendar'

describe('tripDayItems', () => {
  it('skips a trip with no starts_on', () => {
    expect(
      tripDayItems([{ id: 't1', name: 'Someday', starts_on: null, ends_on: null }], {
        from: '2026-09-01',
        to: '2026-09-30',
      }),
    ).toHaveLength(0)
  })

  it('is one item, unnumbered, for a one day trip', () => {
    const items = tripDayItems(
      [{ id: 't1', name: 'City day', starts_on: '2026-09-10', ends_on: null }],
      { from: '2026-09-01', to: '2026-09-30' },
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 't1:2026-09-10', title: 'City day', kind: 'trip' })
  })

  it('numbers each day of a multi day trip', () => {
    const items = tripDayItems(
      [{ id: 't1', name: 'Japan', starts_on: '2026-09-10', ends_on: '2026-09-12' }],
      { from: '2026-09-01', to: '2026-09-30' },
    )
    expect(items.map((i) => i.title)).toEqual([
      'Japan, day 1 of 3',
      'Japan, day 2 of 3',
      'Japan, day 3 of 3',
    ])
  })

  it('crosses a month boundary and only emits the days the range covers', () => {
    // Six days, 28 September to 3 October, but the range asked for is October only.
    const items = tripDayItems(
      [{ id: 't1', name: 'Around the change', starts_on: '2026-09-28', ends_on: '2026-10-03' }],
      { from: '2026-10-01', to: '2026-10-31' },
    )
    // Day numbers stay relative to the whole trip, not the clipped range.
    expect(items.map((i) => i.title)).toEqual([
      'Around the change, day 4 of 6',
      'Around the change, day 5 of 6',
      'Around the change, day 6 of 6',
    ])
    expect(items.map((i) => i.startsAt)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
  })
})

describe('itineraryItems', () => {
  const range = { from: '2026-09-01', to: '2026-09-30' }

  it('drops an item with no date or outside the range', () => {
    expect(
      itineraryItems(
        [
          { id: 'i1', trip_id: 't1', title: 'Flight', occurs_on: null, occurs_at: null },
          { id: 'i2', trip_id: 't1', title: 'Flight', occurs_on: '2026-08-31', occurs_at: null },
        ],
        range,
      ),
    ).toHaveLength(0)
  })

  it('links to the trip and carries its title', () => {
    const [item] = itineraryItems(
      [{ id: 'i1', trip_id: 't1', title: 'Hotel check-in', occurs_on: '2026-09-05', occurs_at: null }],
      range,
    )
    expect(item).toMatchObject({ title: 'Hotel check-in', href: '/travel?trip=t1', kind: 'itinerary' })
  })

  it('carries the item time when it has one, and is all day when not', () => {
    const [timed, untimed] = itineraryItems(
      [
        { id: 'i1', trip_id: 't1', title: 'Check in, Kyoto', occurs_on: '2026-09-05', occurs_at: '15:00' },
        { id: 'i2', trip_id: 't1', title: 'Museum', occurs_on: '2026-09-06', occurs_at: null },
      ],
      range,
    )
    expect(timed).toMatchObject({ startsAt: '2026-09-05T15:00', allDay: false })
    expect(untimed).toMatchObject({ startsAt: '2026-09-06', allDay: true })
  })
})
