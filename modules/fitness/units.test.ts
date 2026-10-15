import { describe, expect, it } from 'vitest'
import {
  bestSet,
  clock12,
  distance,
  duration,
  elevation,
  hoursLabel,
  load,
  mass,
  pace,
  screenState,
  shortDate,
  sourcesLabel,
  speed,
  temperature,
  toGrams,
  whenLabel,
} from './units'

describe('mass', () => {
  it('renders the number that was actually loaded on the bar', () => {
    expect(mass(toGrams(275, 'lb'))).toBe('275 lb')
    expect(mass(toGrams(45, 'lb'))).toBe('45 lb')
  })

  it('round trips through either unit', () => {
    expect(mass(toGrams(100, 'kg'), 'kg')).toBe('100 kg')
    expect(mass(toGrams(225, 'lb'), 'lb')).toBe('225 lb')
  })

  it('rounds kilograms to the half, because plates come in 1.25s', () => {
    expect(mass(102_300, 'kg')).toBe('102.5 kg')
  })
})

describe('shortDate', () => {
  it('dates a row in the owner\'s zone, not the renderer\'s', () => {
    // 20:30 on Sep 12 in Chicago is 01:30 on Sep 13 in UTC, where the server runs.
    expect(shortDate('2026-09-13T01:30:00.000Z', 'America/Chicago')).toBe('Sep 12')
    expect(shortDate('2026-09-13T01:30:00.000Z', 'UTC')).toBe('Sep 13')
  })
})

describe('distance', () => {
  it('reads in miles, because the owner reads imperial', () => {
    // 5,100 m is the 5 km run Health Auto Export sent as 3.17 mi.
    expect(distance(5100)).toBe('3.17 mi')
    expect(distance(1609.344)).toBe('1.00 mi')
  })

  it('switches to feet under a tenth of a mile', () => {
    expect(distance(100)).toBe('328 ft')
  })

  it('still renders metric when asked for it', () => {
    expect(distance(820, 'km')).toBe('820 m')
    expect(distance(5100, 'km')).toBe('5.1 km')
  })

  it('reads a pool swim in yards', () => {
    // 500 yd, as a yard pool measures it and Apple Health sends it.
    expect(distance(457.2, 'yd')).toBe('500 yd')
  })

  it('says nothing for a workout that covered no ground', () => {
    expect(distance(0)).toBe('')
  })
})

describe('duration', () => {
  it('reads minutes under an hour and hours over one', () => {
    expect(duration(3480)).toBe('58m')
    expect(duration(3720)).toBe('1h 02m')
  })
})

describe('pace', () => {
  it('is minutes and seconds per mile', () => {
    // 5,600 m is 3.48 mi, and 50 minutes over it is 14:22/mi.
    expect(pace(5600, 3000)).toBe('14:22/mi')
    // 7,200 m is 4.47 mi, and 46 minutes over it is 10:17/mi.
    expect(pace(7200, 2760)).toBe('10:17/mi')
  })

  it('still renders metric when asked for it', () => {
    // 5.6 km in 50 minutes is 8:56/km.
    expect(pace(5600, 3000, 'km')).toBe('8:56/km')
  })

  it('paces a swim per hundred yards', () => {
    // 500 yd in 16:15 is 3:15 per 100 yd.
    expect(pace(457.2, 975, 'yd')).toBe('3:15/100yd')
  })

  it('never produces a time ending in sixty seconds', () => {
    // Naive rounding of 479.6 seconds per mile gives 7:60, which is not a time.
    expect(pace(1609.344, 479.6)).toBe('8:00/mi')
    expect(pace(1000, 479.6, 'km')).toBe('8:00/km')
  })

  it('says nothing when there is no distance to divide by', () => {
    expect(pace(0, 3000)).toBe('')
    expect(pace(50, 3000)).toBe('')
  })
})

describe('bestSet', () => {
  const set = (weightLb: number, reps: number) => ({ weightG: toGrams(weightLb, 'lb'), reps })

  it('takes the heaviest', () => {
    expect(bestSet([set(245, 10), set(275, 3)])).toEqual(set(275, 3))
  })

  it('breaks a tie on reps, because five beats three at the same weight', () => {
    expect(bestSet([set(275, 3), set(275, 5), set(275, 1)])).toEqual(set(275, 5))
  })

  it('has nothing to say about an empty workout', () => {
    expect(bestSet([])).toBeNull()
  })
})

describe('load', () => {
  it('weights a run above a ride of the same length', () => {
    const run = load([{ kind: 'run', durationS: 3600 }])
    const ride = load([{ kind: 'ride', durationS: 3600 }])
    expect(run).toBeGreaterThan(ride)
  })

  it('counts a walk as barely training', () => {
    expect(load([{ kind: 'walk', durationS: 3600 }])).toBe(30)
  })

  it('sums a week', () => {
    expect(
      load([
        { kind: 'strength', durationS: 3600 },
        { kind: 'run', durationS: 1800 },
      ]),
    ).toBe(72 + 42)
  })

  it('treats a kind it has never heard of as ordinary rather than free', () => {
    expect(load([{ kind: 'kitesurfing', durationS: 3600 }])).toBe(60)
  })
})

describe('the overview labels', () => {
  it('names when a set happened', () => {
    expect(whenLabel('2026-09-12T18:00:00.000Z', '2026-09-12', 'America/Chicago')).toBe('Today')
    expect(whenLabel('2026-09-11T18:00:00.000Z', '2026-09-12', 'America/Chicago')).toBe('Yesterday')
    expect(whenLabel('2026-09-04T18:00:00.000Z', '2026-09-12', 'America/Chicago')).toBe('Sep 04')
  })

  it('dates a late-evening set by the owner\'s calendar, not UTC', () => {
    // 21:30 in Chicago on the 11th is already the 12th in UTC.
    expect(whenLabel('2026-09-12T02:30:00.000Z', '2026-09-12', 'America/Chicago')).toBe('Yesterday')
    expect(whenLabel('2026-09-12T02:30:00.000Z', '2026-09-13', 'America/Chicago')).toBe('Sep 11')
  })

  it('prints the week in hours and minutes', () => {
    expect(hoursLabel(222)).toBe('3h 42m')
    expect(hoursLabel(51)).toBe('51m')
    expect(hoursLabel(120)).toBe('2h 00m')
  })

  it('counts where the rows came from and drops zeros', () => {
    expect(sourcesLabel([{ source: 'strava' }, { source: 'demo' }, { source: 'manual' }])).toBe('1 Strava · 2 by hand')
    expect(
      sourcesLabel([{ source: 'health_auto_export' }, { source: 'apple_shortcuts' }, { source: 'manual' }]),
    ).toBe('2 Apple Health · 1 by hand')
    expect(sourcesLabel([{ source: 'demo' }])).toBe('1 by hand')
    expect(sourcesLabel([])).toBe('')
  })

  it('draws the setup card only when there is nothing at all', () => {
    expect(screenState({ workouts: 0, metrics: 0, connected: false })).toBe('setup')
    expect(screenState({ workouts: 0, metrics: 0, connected: true })).toBe('setup-connected')
    expect(screenState({ workouts: 3, metrics: 0, connected: false })).toBe('live')
    // Readings with no workouts: what a phone that cannot send workouts leaves.
    expect(screenState({ workouts: 0, metrics: 4, connected: false })).toBe('live')
  })
})

describe('the workout drawer readings', () => {
  it('reads speed, elevation and temperature in imperial', () => {
    expect(speed(2.9622)).toBe('6.6 mph')
    expect(elevation(44.8)).toBe('147 ft')
    expect(temperature(32.3)).toBe('90°F')
    expect(temperature(-1)).toBe('30°F')
  })

  it('reads a start time on a twelve hour clock in the owner zone', () => {
    // 11:42 UTC is 6:42 in Central daylight time.
    expect(clock12('2026-09-11T11:42:00Z', 'America/Chicago')).toBe('6:42 am')
    expect(clock12('2026-09-11T17:05:00Z', 'America/Chicago')).toBe('12:05 pm')
    expect(clock12('2026-09-11T05:05:00Z', 'America/Chicago')).toBe('12:05 am')
  })
})
