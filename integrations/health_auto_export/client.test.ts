import { describe, expect, it } from 'vitest'
import { toBodyMetrics, toWorkouts } from './client'

const at = (day: string, time = '07:30:00') => `${day} ${time} -0500`
const metric = (name: string, units: string, data: Record<string, unknown>[]) => ({ name, units, data })

describe('toBodyMetrics', () => {
  it('maps the daily totals and levels onto their kinds and units', () => {
    const rows = toBodyMetrics({
      data: {
        metrics: [
          metric('step_count', 'count', [{ qty: 8135.4, date: at('2026-09-11') }]),
          metric('active_energy', 'kcal', [{ qty: 540.3, date: at('2026-09-11') }]),
          metric('apple_exercise_time', 'min', [{ qty: 36, date: at('2026-09-11') }]),
          metric('apple_stand_hour', 'count', [{ qty: 10, date: at('2026-09-11') }]),
          // Minutes stood, a different metric; it must not add to the hours.
          metric('apple_stand_time', 'min', [{ qty: 99, date: at('2026-09-11') }]),
          metric('vo2_max', 'mL/min·kg', [{ qty: 38.6, date: at('2026-09-11') }]),
          metric('blood_oxygen_saturation', '%', [{ qty: 98.1, date: at('2026-09-11') }]),
          metric('respiratory_rate', 'count/min', [{ qty: 15.2, date: at('2026-09-11') }]),
          metric('flights_climbed', 'count', [{ qty: 9, date: at('2026-09-11') }]),
          metric('walking_running_distance', 'mi', [{ qty: 3.7, date: at('2026-09-11') }]),
          metric('walking_heart_rate_average', 'bpm', [{ qty: 101, date: at('2026-09-11') }]),
          metric('heart_rate', 'bpm', [{ Min: 51, Avg: 74.4, Max: 149, date: at('2026-09-11') }]),
          // The docs spell weight with an ampersand; the older spelling stays.
          metric('weight_&_body_mass', 'lb', [{ qty: 176.4, date: at('2026-09-11') }]),
        ],
      },
    })
    expect(rows).toEqual([
      { kind: 'steps', measuredOn: '2026-09-11', value: 8135 },
      { kind: 'active_energy', measuredOn: '2026-09-11', value: 540 },
      { kind: 'exercise_minutes', measuredOn: '2026-09-11', value: 36 },
      { kind: 'stand_hours', measuredOn: '2026-09-11', value: 10 },
      { kind: 'vo2_max', measuredOn: '2026-09-11', value: 386 },
      { kind: 'blood_oxygen', measuredOn: '2026-09-11', value: 981 },
      { kind: 'respiratory_rate', measuredOn: '2026-09-11', value: 152 },
      { kind: 'flights_climbed', measuredOn: '2026-09-11', value: 9 },
      { kind: 'walking_distance', measuredOn: '2026-09-11', value: 5955 },
      { kind: 'walking_hr_avg', measuredOn: '2026-09-11', value: 101 },
      { kind: 'heart_rate_avg', measuredOn: '2026-09-11', value: 74 },
      { kind: 'weight', measuredOn: '2026-09-11', value: 80014 },
    ])
  })

  // The app can be set to send hourly buckets. A total is the sum of its day's
  // buckets; a level is whatever was read last. Neither is the last bucket alone.
  it('sums a total across one day and keeps the last reading of a level', () => {
    const rows = toBodyMetrics({
      data: {
        metrics: [
          metric('step_count', 'count', [
            { qty: 1200, date: at('2026-09-11', '08:00:00') },
            { qty: 3400, date: at('2026-09-11', '12:00:00') },
            { qty: 800, date: at('2026-09-12', '08:00:00') },
          ]),
          metric('blood_oxygen_saturation', '%', [
            { qty: 96, date: at('2026-09-11', '08:00:00') },
            { qty: 98, date: at('2026-09-11', '22:00:00') },
          ]),
        ],
      },
    })
    expect(rows).toEqual([
      { kind: 'steps', measuredOn: '2026-09-11', value: 4600 },
      { kind: 'steps', measuredOn: '2026-09-12', value: 800 },
      { kind: 'blood_oxygen', measuredOn: '2026-09-11', value: 980 },
    ])
  })

  // Some sleep trackers write overlapping records, which make the app's
  // summed hours two to three times the night. The span between
  // sleepStart and sleepEnd is the night, dated by the morning it ended.
  it('reads sleep as the span from sleepStart to sleepEnd, not the summed hours', () => {
    const rows = toBodyMetrics({
      data: {
        metrics: [
          metric('sleep_analysis', 'hr', [
            {
              date: '2026-06-22 00:00:00 -0500',
              sleepStart: '2026-06-22 00:37:00 -0500',
              sleepEnd: '2026-06-22 10:09:00 -0500',
              totalSleep: 26.766666666666666,
              inBed: 27.400000000000006,
              asleep: 0,
            },
            // The older shape without a span still reads its hours.
            { date: '2026-06-23 00:00:00 -0500', asleep: 7.5 },
          ]),
        ],
      },
    })
    expect(rows).toEqual([
      { kind: 'sleep_minutes', measuredOn: '2026-06-22', value: 572 },
      { kind: 'sleep_minutes', measuredOn: '2026-06-23', value: 450 },
    ])
  })

  // A tracker session can end in the afternoon (22:52 to 17:09) with a
  // plausible totalSleep, so the span is 13 to 20 hours and the hours are
  // right. The smaller of the two is the night.
  it('takes the smaller of the span and the summed hours', () => {
    const rows = toBodyMetrics({
      data: {
        metrics: [
          metric('sleep_analysis', 'hr', [
            {
              date: '2026-09-13 00:00:00 -0500',
              sleepStart: '2026-09-12 22:52:00 -0500',
              sleepEnd: '2026-09-13 17:09:30 -0500',
              totalSleep: 7.091666666666667,
              asleep: 0,
            },
          ]),
        ],
      },
    })
    expect(rows).toEqual([{ kind: 'sleep_minutes', measuredOn: '2026-09-13', value: 426 }])
  })

  // Same export: 11 nights had the span and the hours both over 12 hours.
  it('skips a night whose best reading is over 14 hours', () => {
    const rows = toBodyMetrics({
      data: {
        metrics: [
          metric('sleep_analysis', 'hr', [
            {
              date: '2026-02-18 00:00:00 -0600',
              sleepStart: '2026-02-17 23:16:00 -0600',
              sleepEnd: '2026-02-18 14:44:00 -0600',
              totalSleep: 15.666666666666666,
              asleep: 0,
            },
          ]),
        ],
      },
    })
    expect(rows).toEqual([])
  })

  it('converts kilojoules to kilocalories and takes anything else as kilocalories', () => {
    const energy = (units: string, q: number) =>
      toBodyMetrics({ data: { metrics: [metric('active_energy', units, [{ qty: q, date: at('2026-09-11') }])] } })[0]
        .value

    // 2,563.7 kJ is the same 613 kcal the kcal payload sends.
    expect(energy('kJ', 2563.7)).toBe(613)
    expect(energy('kcal', 612.7)).toBe(613)
    // A units string that does not read is kilocalories, not a dropped day:
    // that is what Apple Health stores and what every export has sent.
    expect(energy('', 612.7)).toBe(613)
  })
})

describe('toWorkouts', () => {
  const run = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Running',
    start: '2026-09-11 07:00:00 -0500',
    end: '2026-09-11 07:30:00 -0500',
    duration: 1800.4,
    activeEnergyBurned: { qty: 350.2, units: 'kcal' },
    distance: { qty: 3.5, units: 'mi' },
    heartRate: { min: { qty: 120, units: 'bpm' }, avg: { qty: 150.6, units: 'bpm' }, max: { qty: 175, units: 'bpm' } },
  }

  it('reads a v2 workout into the columns fitness.workout has', () => {
    expect(toWorkouts({ data: { workouts: [run] } })).toEqual([
      {
        externalId: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Running',
        kind: 'run',
        startedAt: '2026-09-11 07:00:00 -0500',
        durationS: 1800,
        distanceM: 5632.7,
        avgHr: 151,
        detail: '350 kcal',
        stats: { endedAt: '2026-09-11T07:30:00-05:00', activeKcal: 350, minHr: 120, maxHr: 175 },
      },
    ])
  })

  it('names the kind from the workout name the way the Strava sync does', () => {
    const kinds = (names: string[]) =>
      toWorkouts({ data: { workouts: names.map((name, i) => ({ ...run, id: String(i), name })) } }).map(
        (w) => w.kind,
      )
    expect(
      kinds([
        'Traditional Strength Training',
        'Functional Strength Training',
        'High Intensity Interval Training',
        'Outdoor Run',
        'Cycling',
        'Pool Swim',
        'Hiking',
        'Walking',
        'Yoga',
      ]),
    ).toEqual(['strength', 'strength', 'strength', 'run', 'ride', 'swim', 'walk', 'walk', 'other'])
  })

  it('converts km and yards, tolerates missing optionals, and skips what has no id, start or duration', () => {
    const rows = toWorkouts({
      data: {
        workouts: [
          { id: 'a', name: 'Cycling', start: run.start, end: run.end, duration: 3600, distance: { qty: 20, units: 'km' } },
          { id: 'b', name: 'Pool Swim', start: run.start, end: run.end, duration: 1800, distance: { qty: 500, units: 'yd' } },
          { name: 'Legacy v1', start: run.start, end: run.end, totalEnergy: { qty: 1 } },
          { id: 'c', name: 'No start', duration: 60 },
          { id: 'd', name: 'Bad date', start: '11/09/2026', duration: 60 },
        ],
      },
    })
    expect(rows).toEqual([
      {
        externalId: 'a',
        name: 'Cycling',
        kind: 'ride',
        startedAt: run.start,
        durationS: 3600,
        distanceM: 20000,
        avgHr: null,
        detail: '',
        stats: { endedAt: '2026-09-11T07:30:00-05:00' },
      },
      {
        externalId: 'b',
        name: 'Pool Swim',
        kind: 'swim',
        startedAt: run.start,
        durationS: 1800,
        distanceM: 457.2,
        avgHr: null,
        detail: '',
        stats: { endedAt: '2026-09-11T07:30:00-05:00' },
      },
    ])
  })

  // The optional scalars as the 2026-09-19 export sent them (numbers only):
  // avgSpeed carries a bare `mi` that means mph, stepCount is a series, and a
  // pool swim's speed is yd/hr.
  const full = {
    ...run,
    location: 'Outdoor',
    totalEnergy: { qty: 441.44, units: 'kcal' },
    intensity: { qty: 11.21, units: 'kcal/hr·kg' },
    avgSpeed: { qty: 6.6263, units: 'mi' },
    maxSpeed: { qty: 10.7355, units: 'mi' },
    elevationUp: { qty: 146.88, units: 'ft' },
    temperature: { qty: 90.14, units: 'degF' },
    humidity: { qty: 54, units: '%' },
    heartRate: { ...run.heartRate, min: { qty: 95, units: 'bpm' }, max: { qty: 171, units: 'bpm' } },
    stepCount: [
      { qty: 150.2, units: 'steps', date: run.start },
      { qty: 160.4, units: 'steps', date: run.start },
    ],
    stepCadence: { qty: 154.4, units: 'count/min' },
    flightsClimbed: { qty: 8.72, units: 'count' },
    heartRateData: [{ Min: 95, Avg: 113, Max: 131, units: 'bpm', date: run.start }],
    route: [{ latitude: 0, longitude: 0 }],
  }

  it('keeps every scalar the export sends as stats in the app units, and drops the series', () => {
    expect(toWorkouts({ data: { workouts: [full] } })[0].stats).toEqual({
      endedAt: '2026-09-11T07:30:00-05:00',
      location: 'Outdoor',
      activeKcal: 350,
      totalKcal: 441,
      met: 11.2,
      avgSpeedMps: 2.96,
      maxSpeedMps: 4.8,
      elevationUpM: 44.8,
      tempC: 32.3,
      humidityPct: 54,
      minHr: 95,
      maxHr: 171,
      steps: 311,
      cadenceSpm: 154,
      flights: 9,
    })
  })

  it('reads a pool swim, speed in yd/hr, location from isIndoor, and the bare minimum as almost nothing', () => {
    const swim = {
      id: 's',
      name: 'Pool Swim',
      start: run.start,
      duration: 1800,
      isIndoor: true,
      speed: { qty: 1400, units: 'yd/hr' },
      lapLength: { qty: 25, units: 'yd' },
      totalSwimmingStrokeCount: { qty: 307, units: 'count' },
    }
    expect(toWorkouts({ data: { workouts: [swim] } })[0].stats).toEqual({
      location: 'Indoor',
      avgSpeedMps: 0.36,
      lapLengthM: 22.86,
      strokes: 307,
    })
    expect(toWorkouts({ data: { workouts: [{ id: 'x', start: run.start, duration: 60 }] } })[0].stats).toEqual({})
  })

  it("reads a workout's energy in the units it arrived in", () => {
    const detail = (activeEnergyBurned: { qty: number; units: string }) =>
      toWorkouts({ data: { workouts: [{ ...run, activeEnergyBurned }] } })[0].detail

    expect(detail({ qty: 1465.2, units: 'kJ' })).toBe('350 kcal')
    expect(detail({ qty: 350.2, units: 'kcal' })).toBe('350 kcal')
  })
})
