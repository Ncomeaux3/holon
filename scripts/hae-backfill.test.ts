import { describe, expect, it } from 'vitest'
import { chunk, parseArgs, sleepReport } from './hae-backfill-lib'

const point = (date: string, qty = 1) => ({ date: `${date} 08:00:00 -0500`, qty })

describe('chunk', () => {
  it('sends one request per month with every metric of that month, and workouts in twenties', () => {
    const payload = {
      data: {
        metrics: [
          { name: 'step_count', units: 'count', data: [point('2026-01-03'), point('2026-01-04'), point('2026-02-01')] },
          { name: 'weight_body_mass', units: 'lb', data: [point('2026-02-10', 190)] },
        ],
        workouts: Array.from({ length: 45 }, (_, i) => ({ id: String(i), start: `2026-03-0${(i % 9) + 1} 07:00:00 -0500` })),
      },
    }
    const out = chunk(payload)
    expect(out.map((c) => Object.keys(c.data))).toEqual([['metrics'], ['metrics'], ['workouts'], ['workouts'], ['workouts']])
    expect(out[0].data.metrics).toEqual([{ name: 'step_count', units: 'count', data: [point('2026-01-03'), point('2026-01-04')] }])
    expect(out[1].data.metrics).toEqual([
      { name: 'step_count', units: 'count', data: [point('2026-02-01')] },
      { name: 'weight_body_mass', units: 'lb', data: [point('2026-02-10', 190)] },
    ])
    expect(out.slice(2).map((c) => c.data.workouts?.length)).toEqual([20, 20, 5])
  })

  it('drops the series arrays a workout carries and keeps its scalar fields', () => {
    const w = { id: 'a', name: 'Outdoor Run', start: '2026-09-16 17:26:05 -0500', duration: 1662, route: [{ lat: 1 }], heartRateData: [1, 2], heartRate: { avg: { qty: 152, units: 'bpm' } } }
    const out = chunk({ data: { workouts: [w] } })
    expect(out[0].data.workouts).toEqual([{ id: 'a', name: 'Outdoor Run', start: '2026-09-16 17:26:05 -0500', duration: 1662, heartRate: { avg: { qty: 152, units: 'bpm' } } }])
  })

  it('keeps a point whose date does not read, under its own bucket, rather than dropping it', () => {
    const out = chunk({ data: { metrics: [{ name: 'step_count', data: [{ qty: 1 }] }] } })
    expect(out).toHaveLength(1)
    expect(out[0].data.metrics?.[0].data).toEqual([{ qty: 1 }])
  })
})

describe('parseArgs', () => {
  const DEFAULT = 'https://pos.example/webhook'

  it('reads the export file after --url rather than taking the URL for it', () => {
    expect(parseArgs(['--url', 'http://localhost:3000/hook', 'export.json'], DEFAULT)).toEqual({
      file: 'export.json',
      url: 'http://localhost:3000/hook',
      dryRun: false,
      sleep: false,
    })
  })

  it('takes the flags in any order around the file and defaults the URL', () => {
    expect(parseArgs(['--dry-run', 'export.json', '--sleep'], DEFAULT)).toEqual({
      file: 'export.json',
      url: DEFAULT,
      dryRun: true,
      sleep: true,
    })
  })

  // The first-non-flag read took --dryrun for a flag it did not know and
  // posted for real.
  it('refuses a misspelled flag rather than posting to production', () => {
    expect(() => parseArgs(['export.json', '--dryrun'], DEFAULT)).toThrow('unknown flag --dryrun')
  })

  it('refuses --url with nothing after it', () => {
    expect(() => parseArgs(['export.json', '--url'], DEFAULT)).toThrow('--url needs a URL after it')
    expect(() => parseArgs(['--url', '--dry-run', 'export.json'], DEFAULT)).toThrow('--url needs a URL after it')
  })

  it('refuses a second export file and no export file', () => {
    expect(() => parseArgs(['a.json', 'b.json'], DEFAULT)).toThrow('one export file at a time')
    expect(() => parseArgs(['--dry-run'], DEFAULT)).toThrow('no export file given')
  })
})

describe('sleepReport', () => {
  const sleep = (data: Record<string, unknown>[]) => ({
    data: { metrics: [{ name: 'sleep_analysis', units: 'hr', data }] },
  })

  // The night in the 2026-09-18 export: a 9h32m span the app summed to 26h46m.
  it('gives each night its span beside the hours the app summed', () => {
    expect(
      sleepReport(
        sleep([
          {
            date: '2026-06-22 00:00:00 -0500',
            sleepStart: '2026-06-22 00:37:00 -0500',
            sleepEnd: '2026-06-22 10:09:00 -0500',
            totalSleep: 26.766666666666666,
            inBed: 27.4,
            asleep: 0,
          },
        ]),
      ),
    ).toEqual([
      {
        day: '2026-06-22',
        storedMin: 572,
        points: [
          {
            start: '2026-06-22 00:37:00 -0500',
            end: '2026-06-22 10:09:00 -0500',
            ownMin: 572,
            totalSleepMin: 1606,
            asleepMin: 0,
            inBedMin: 1644,
          },
        ],
      },
    ])
  })

  // The case the report exists to find: a nap and a night share a date, and
  // the day keeps the last point rather than the longer one, so 6h50m of
  // sleep is stored as 1h50m.
  it('shows both points of a day and the one the day collapses to', () => {
    const report = sleepReport(
      sleep([
        { sleepStart: '2026-07-04 01:10:00 -0500', sleepEnd: '2026-07-04 08:00:00 -0500' },
        { sleepStart: '2026-07-04 13:30:00 -0500', sleepEnd: '2026-07-04 15:20:00 -0500' },
      ]),
    )
    expect(report).toHaveLength(1)
    expect(report[0].day).toBe('2026-07-04')
    expect(report[0].points.map((p) => p.ownMin)).toEqual([410, 110])
    expect(report[0].storedMin).toBe(110)
  })

  it('reads a point with no span through its hours, and buckets one with no date under ?', () => {
    expect(sleepReport(sleep([{ date: '2026-06-23 00:00:00 -0500', asleep: 7.5 }]))[0]).toEqual({
      day: '2026-06-23',
      storedMin: 450,
      points: [{ start: '', end: '', ownMin: 450, totalSleepMin: null, asleepMin: 450, inBedMin: null }],
    })
    expect(sleepReport(sleep([{ asleep: 7.5 }]))).toEqual([
      {
        day: '?',
        storedMin: null,
        points: [{ start: '', end: '', ownMin: null, totalSleepMin: null, asleepMin: 450, inBedMin: null }],
      },
    ])
  })

  it('has nothing to say about an export with no sleep in it', () => {
    expect(sleepReport({ data: { metrics: [{ name: 'step_count', data: [point('2026-01-03')] }] } })).toEqual([])
  })
})
