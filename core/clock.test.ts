import { describe, expect, it } from 'vitest'
import { startOfWeek, syncClock } from './clock'

describe('syncClock', () => {
  const now = new Date('2026-09-19T17:06:00Z') // 12:06 in Chicago

  it('prints the time alone when the run was today in the owner\'s zone', () => {
    expect(syncClock('2026-09-19T16:44:00Z', 'America/Chicago', now)).toBe('11:44')
  })

  it('adds the day once the run is older than today', () => {
    // 22:10 on Sep 18 in Chicago is already Sep 19 in UTC: yesterday for the
    // owner, today for the server. The day is the owner's.
    expect(syncClock('2026-09-19T03:10:00Z', 'America/Chicago', now)).toBe('18 Sep 22:10')
    expect(syncClock('2026-09-19T03:10:00Z', 'UTC', now)).toBe('03:10')
    expect(syncClock('2026-09-18T15:10:00Z', 'America/Chicago', now)).toBe('18 Sep 10:10')
  })
})

describe('startOfWeek', () => {
  // 2026-10-14 is a Wednesday.
  it('goes back to the Monday or the Sunday', () => {
    expect(startOfWeek('2026-10-14', 'monday')).toBe('2026-10-12')
    expect(startOfWeek('2026-10-14', 'sunday')).toBe('2026-10-11')
  })

  it('keeps the start day itself and puts the last day in the same week', () => {
    expect(startOfWeek('2026-10-12', 'monday')).toBe('2026-10-12')
    expect(startOfWeek('2026-10-18', 'monday')).toBe('2026-10-12')
    expect(startOfWeek('2026-10-11', 'sunday')).toBe('2026-10-11')
    expect(startOfWeek('2026-10-17', 'sunday')).toBe('2026-10-11')
    // A Sunday starts a Sunday week and ends a Monday one.
    expect(startOfWeek('2026-10-18', 'sunday')).toBe('2026-10-18')
  })

  it('crosses a year boundary', () => {
    // 2027-01-01 is a Friday.
    expect(startOfWeek('2027-01-01', 'monday')).toBe('2026-12-28')
    expect(startOfWeek('2027-01-01', 'sunday')).toBe('2026-12-27')
    expect(startOfWeek('2027-01-02', 'sunday')).toBe('2026-12-27')
    expect(startOfWeek('2027-01-03', 'sunday')).toBe('2027-01-03')
  })
})
