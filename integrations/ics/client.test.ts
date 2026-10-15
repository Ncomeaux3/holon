import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { feedKey, feedUrls, httpUrl, parseIcs } from './client'

// The fixture is an iCloud export's shape: a VTIMEZONE block, an alarm inside
// an event, a folded SUMMARY, escaped punctuation, four recurrence rules, one
// moved instance and one rule nothing here expands.
const ICS = readFileSync(new URL('../../e2e/fixtures/icloud.ics', import.meta.url), 'utf8')

const WINDOW = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2027-09-01T00:00:00Z') }
const parse = (text = ICS, over: Partial<typeof WINDOW> = {}) =>
  parseIcs(text, { ...WINDOW, ...over, zone: 'America/Chicago' })

const byUid = (uid: string) => parse().events.filter((e) => e.uid === uid || e.uid.startsWith(`${uid}/`))

describe('httpUrl', () => {
  it('rewrites webcal, which no HTTP client speaks, to https', () => {
    expect(httpUrl('webcal://p01.icloud.com/published/2/abc')).toBe('https://p01.icloud.com/published/2/abc')
  })

  it('leaves an https URL alone', () => {
    expect(httpUrl('https://example.com/f.ics')).toBe('https://example.com/f.ics')
  })
})

describe('feedUrls', () => {
  it('reads the list the panel saves', () => {
    expect(feedUrls({ urls: '["https://a.test/1.ics","https://b.test/2.ics"]' })).toEqual([
      'https://a.test/1.ics',
      'https://b.test/2.ics',
    ])
  })

  // What the card's own field saves before the panel exists: one pasted URL.
  it('reads a single pasted URL', () => {
    expect(feedUrls({ urls: 'webcal://p01.icloud.com/published/2/abc' })).toEqual([
      'webcal://p01.icloud.com/published/2/abc',
    ])
  })

  it('has nothing to pull with no credentials', () => {
    expect(feedUrls(null)).toEqual([])
  })
})

describe('feedKey', () => {
  it('is stable for one URL and different for another', () => {
    expect(feedKey('https://a.test/1.ics')).toBe(feedKey('https://a.test/1.ics'))
    expect(feedKey('https://a.test/1.ics')).not.toBe(feedKey('https://a.test/2.ics'))
  })

  // The key prefixes an external_id, and webcal and https are the same feed.
  it('reads a webcal URL and its https form as one feed', () => {
    expect(feedKey('webcal://p01.icloud.com/x')).toBe(feedKey('https://p01.icloud.com/x'))
  })
})

describe('parseIcs', () => {
  it('takes the calendar name from X-WR-CALNAME', () => {
    expect(parse().name).toBe('Family')
  })

  it('reads a zoned event as the instant that wall clock is in its zone', () => {
    // 09:00 in Chicago on 1 October is 14:00 UTC (CDT, -5).
    expect(byUid('standup@icloud')[0]).toMatchObject({
      title: 'Standup',
      location: 'Kitchen table',
      allDay: false,
      start: '2026-10-01T14:00:00.000Z',
      end: '2026-10-01T14:15:00.000Z',
    })
  })

  it('reads a UTC stamp as itself and unescapes the text', () => {
    expect(byUid('flight@icloud')[0]).toMatchObject({
      title: 'Flight WN1187, seat 22A',
      location: 'Gate C7; Concourse C',
      url: 'https://www.example.com/mytrips',
      start: '2026-10-03T15:00:00.000Z',
    })
  })

  // DTEND is exclusive for a date, as it is in Google's API.
  it('stores an all day span by date, ending on its last day', () => {
    expect(byUid('trip@icloud')[0]).toMatchObject({
      allDay: true,
      start: '2026-11-20',
      end: '2026-11-22',
    })
  })

  it('unfolds a summary split across lines', () => {
    expect(byUid('swim@icloud')[0].title).toBe(
      'Lap swim at the community pool with the Monday and Wednesday morning group',
    )
  })

  it('reads CRLF, which is what a feed actually sends', () => {
    const crlf = parse(ICS.replace(/\n/g, '\r\n'))
    expect(crlf.events.find((e) => e.uid === 'standup@icloud')?.title).toBe('Standup')
  })

  it('drops a cancelled event', () => {
    expect(byUid('cancelled@icloud')).toEqual([])
  })

  describe('recurrence', () => {
    it('expands a weekly rule on two weekdays, counting to COUNT and skipping an EXDATE', () => {
      const swim = byUid('swim@icloud')
      // Mon 5th, Wed 7th (excluded), Mon 12th (moved, below), Wed 14th.
      expect(swim.map((e) => e.start.slice(0, 10))).toEqual(['2026-10-05', '2026-10-12', '2026-10-14'])
      expect(swim.map((e) => e.uid)).toEqual([
        'swim@icloud/20261005',
        'swim@icloud/20261012',
        'swim@icloud/20261014',
      ])
    })

    // A moved instance arrives as its own VEVENT with RECURRENCE-ID. Without
    // this the day would show the series time and the moved one.
    it('lets a moved instance replace the one the rule would have made', () => {
      const moved = byUid('swim@icloud').find((e) => e.uid.endsWith('20261012'))
      expect(moved).toMatchObject({ title: 'Lap swim, late start', start: '2026-10-12T12:45:00.000Z' })
    })

    it('stops a monthly rule at UNTIL', () => {
      expect(byUid('rent@icloud').map((e) => e.start)).toEqual(['2026-11-01', '2026-12-01', '2027-01-01'])
    })

    // 18:30 in Chicago, so the instants also show the clocks going back on 1
    // November: the same wall clock is -5 in October and -6 after it.
    it('expands a monthly rule on the second Wednesday, across the end of daylight saving', () => {
      expect(byUid('supper-club@icloud').map((e) => e.start)).toEqual([
        '2026-10-14T23:30:00.000Z',
        '2026-11-12T00:30:00.000Z',
        '2026-12-10T00:30:00.000Z',
      ])
    })

    it('expands a yearly rule once inside the window', () => {
      expect(byUid('birthday@icloud').map((e) => e.start)).toEqual(['2026-12-03'])
    })

    it('skips weeks on an interval', () => {
      const fortnightly = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:pay',
        'DTSTART;VALUE=DATE:20261002',
        'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3',
        'SUMMARY:Payday',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\n')
      expect(parse(fortnightly).events.map((e) => e.start)).toEqual(['2026-10-02', '2026-10-16', '2026-10-30'])
    })

    // BYDAY means a different thing under each frequency, and only two of them
    // are expanded here. The rest keep one event rather than a guessed series.
    it.each([
      ['FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', 'every weekday, which DAILY here would read as every day'],
      ['FREQ=MONTHLY;BYDAY=TU', 'every Tuesday of the month, not the first'],
      ['FREQ=YEARLY;BYDAY=MO', 'a weekday of a year'],
      ['FREQ=WEEKLY;INTERVAL=2;WKST=SU', 'a fortnight counted from a different week start'],
    ])('does not guess at %s', (rrule) => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:odd',
        'DTSTART;VALUE=DATE:20261005',
        `RRULE:${rrule}`,
        'SUMMARY:Odd rule',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\n')
      const calendar = parse(ics)
      expect(calendar.events.map((e) => e.start)).toEqual(['2026-10-05'])
      expect(calendar.notes).toEqual([`Odd rule: ${rrule} is kept as one event.`])
    })

    it('still expands a plain weekly rule that names its week start', () => {
      const weekly = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:w',
        'DTSTART;VALUE=DATE:20261005',
        'RRULE:FREQ=WEEKLY;WKST=SU;COUNT=2',
        'SUMMARY:Weekly',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\n')
      expect(parse(weekly).events.map((e) => e.start)).toEqual(['2026-10-05', '2026-10-12'])
    })

    it('keeps an unexpandable rule as its first occurrence and says so', () => {
      expect(byUid('payday@icloud').map((e) => e.start)).toEqual(['2026-10-15'])
      expect(parse().notes).toEqual(['Payday: FREQ=MONTHLY;BYMONTHDAY=15,-1 is kept as one event.'])
    })

    // The standup that has run every weekday since 2015. Counting from its
    // start is what COUNT means, but keeping every date it ever had would fill
    // the cap a decade before the window and leave this year empty.
    it('walks a rule from an old start and still fills the window', () => {
      const old = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:standup',
        'DTSTART;VALUE=DATE:20150106',
        'RRULE:FREQ=DAILY',
        'SUMMARY:Standup',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\n')
      const events = parse(old).events
      // The window's first instant is 19:00 the day before in Chicago, so that
      // day's all-day event overlaps it and is kept: 366, not 365.
      expect(events.length).toBe(366)
      expect(events[0].start).toBe('2026-08-31')
    })

    it('emits nothing outside the window', () => {
      const narrow = parse(ICS, { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-07T00:00:00Z') })
      expect(narrow.events.map((e) => e.uid).sort()).toEqual([
        'flight@icloud',
        'standup@icloud',
        'swim@icloud/20261005',
      ])
    })

    // A daily rule fills the window one row a day, and stops at its edge.
    it('expands a daily rule across the window and no further', () => {
      const daily = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:d',
        'DTSTART;VALUE=DATE:20260901',
        'RRULE:FREQ=DAILY',
        'SUMMARY:Daily',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\n')
      // 1 September 2026 through 31 August 2027: the window's last day is its
      // own start, and an event starting then is past it.
      expect(parse(daily).events.length).toBe(365)
    })
  })

  it('reads a floating time as the owner\'s own clock', () => {
    const floating = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:f',
      'DTSTART:20261002T080000',
      'SUMMARY:Floating',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n')
    expect(parse(floating).events[0].start).toBe('2026-10-02T13:00:00.000Z')
  })

  it('falls back to the owner\'s zone when the feed names one Intl does not know', () => {
    const odd = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:o',
      'DTSTART;TZID=Customized Time Zone:20261002T080000',
      'SUMMARY:Odd zone',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n')
    expect(parse(odd).events[0].start).toBe('2026-10-02T13:00:00.000Z')
  })

  it('ignores an event with no start rather than storing a row with no date', () => {
    const broken = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:b', 'SUMMARY:No date', 'END:VEVENT', 'END:VCALENDAR'].join('\n')
    expect(parse(broken).events).toEqual([])
  })

  it('names an untitled event rather than storing an empty title', () => {
    const untitled = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:u',
      'DTSTART;VALUE=DATE:20261002',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n')
    expect(parse(untitled).events[0].title).toBe('(No title)')
  })

  it('reads text that is not a calendar as no calendar at all', () => {
    expect(() => parseIcs('<html>404</html>', { ...WINDOW, zone: 'America/Chicago' })).toThrow(
      'That URL did not answer with a calendar.',
    )
  })
})
