import { describe, expect, it } from 'vitest'

import { toKind } from './client'

// Strava has upwards of forty sport types and fitness.workout has a check
// constraint allowing five plus 'other'. This map is the whole reason the
// insert does not fail on a sport nobody thought about.

describe('toKind', () => {
  it('maps the sport types the five kinds exist for', () => {
    expect(toKind('Run')).toBe('run')
    expect(toKind('TrailRun')).toBe('run')
    expect(toKind('VirtualRun')).toBe('run')
    expect(toKind('Ride')).toBe('ride')
    expect(toKind('GravelRide')).toBe('ride')
    expect(toKind('EBikeRide')).toBe('ride')
    expect(toKind('Swim')).toBe('swim')
    expect(toKind('Walk')).toBe('walk')
    expect(toKind('Hike')).toBe('walk')
    expect(toKind('WeightTraining')).toBe('strength')
    expect(toKind('Crossfit')).toBe('strength')
    expect(toKind('Workout')).toBe('strength')
  })

  // The important half. An unrecognised sport is a workout that happened, so
  // it lands on 'other' rather than failing the constraint and the whole sync.
  it('sends anything it does not recognise to other', () => {
    expect(toKind('Windsurf')).toBe('other')
    expect(toKind('RockClimbing')).toBe('other')
    expect(toKind('StandUpPaddling')).toBe('other')
    expect(toKind('SomethingStravaAddsNextYear')).toBe('other')
    expect(toKind('')).toBe('other')
  })

  it('does not care about case', () => {
    expect(toKind('RUN')).toBe('run')
    expect(toKind('weighttraining')).toBe('strength')
  })
})
