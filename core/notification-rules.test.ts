import { describe, expect, it } from 'vitest'
import { inQuietHours } from './notify'
import { clockIn, dayIn, minutesIn } from './today'
import { isLive, leadLabel, leadOptions, ruleState, type Rule } from './notification-rules'

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1',
  module: 'finance',
  key: 'statement_due',
  label: 'Statement due',
  trigger_text: 'A statement is due',
  channels: ['email'],
  timing: 'immediate',
  lead_days: 3,
  urgent: true,
  muted: false,
  snooze_until: null,
  sample_title: '',
  sample_body: '',
  position: 1,
  ...over,
})

// Minutes since midnight. inQuietHours takes these rather than a Date so it
// does not read a clock, which is what made it check the server's timezone
// instead of the owner's.
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

describe('inQuietHours', () => {
  it('holds the overnight window that wraps midnight', () => {
    expect(inQuietHours(at('23:30'), '22:00', '06:30')).toBe(true)
    expect(inQuietHours(at('02:00'), '22:00', '06:30')).toBe(true)
    expect(inQuietHours(at('06:29'), '22:00', '06:30')).toBe(true)
  })

  it('lets the waking day through', () => {
    expect(inQuietHours(at('06:30'), '22:00', '06:30')).toBe(false)
    expect(inQuietHours(at('14:00'), '22:00', '06:30')).toBe(false)
    expect(inQuietHours(at('21:59'), '22:00', '06:30')).toBe(false)
  })

  it('handles a window inside one day', () => {
    expect(inQuietHours(at('13:00'), '12:00', '14:00')).toBe(true)
    expect(inQuietHours(at('15:00'), '12:00', '14:00')).toBe(false)
  })
})

describe('isLive and ruleState', () => {
  it('is on when nothing holds it', () => {
    expect(isLive(rule(), false)).toBe(true)
    expect(ruleState(rule(), false).label).toBe('On')
  })

  it('lets the global pause beat everything', () => {
    expect(isLive(rule(), true)).toBe(false)
    expect(ruleState(rule(), true).label).toBe('Paused')
  })

  it('treats a mute as indefinite', () => {
    expect(isLive(rule({ muted: true }), false)).toBe(false)
    expect(ruleState(rule({ muted: true }), false).label).toBe('Muted')
  })

  it('counts a live snooze in days and ignores one that has passed', () => {
    const future = new Date(Date.now() + 6.2 * 86_400_000)
    expect(ruleState(rule({ snooze_until: future }), false).label).toBe('7d')
    expect(isLive(rule({ snooze_until: future }), false)).toBe(false)

    const past = new Date(Date.now() - 86_400_000)
    expect(isLive(rule({ snooze_until: past }), false)).toBe(true)
    expect(ruleState(rule({ snooze_until: past }), false).label).toBe('On')
  })
})

describe('lead times', () => {
  it('names each step the way the screen does', () => {
    expect(leadLabel(0)).toBe('None')
    expect(leadLabel(0.5)).toBe('30m')
    expect(leadLabel(0.25)).toBe('15m')
    expect(leadLabel(1)).toBe('1 day')
    expect(leadLabel(14)).toBe('14 days')
  })

  it('offers a range that suits the module', () => {
    expect(leadOptions('insurance')).toContain(30)
    expect(leadOptions('travel')).toContain(0.5)
    expect(leadOptions('finance')).toEqual([0, 1, 3, 7, 14])
    expect(leadOptions('anything-else')).toEqual([0, 1, 3, 7, 14])
  })
})

// The bug this replaced: inQuietHours read the server clock. On Vercel that is
// UTC, so an owner in Chicago at 19:34 was measured as 00:34 and held inside a
// window they were nowhere near.
describe('the owner clock, not the server clock', () => {
  const evening = new Date('2026-09-10T00:34:00Z') // 19:34 the previous day in Chicago

  it('reads the hour in the owner timezone', () => {
    expect(minutesIn(evening, 'America/Chicago')).toBe(19 * 60 + 34)
    expect(minutesIn(evening, 'UTC')).toBe(34)
  })

  it('is outside quiet hours in Chicago and inside them in UTC', () => {
    expect(inQuietHours(minutesIn(evening, 'America/Chicago'), '22:00', '06:30')).toBe(false)
    expect(inQuietHours(minutesIn(evening, 'UTC'), '22:00', '06:30')).toBe(true)
  })

  it('renders the owner date, not the server date', () => {
    expect(dayIn(evening, 'America/Chicago')).toBe('9 Sep')
    expect(dayIn(evening, 'UTC')).toBe('10 Sep')
    expect(clockIn(evening, 'America/Chicago')).toBe('19:34')
  })

  // Daylight saving moves the offset, and an offset table would go stale.
  it('follows daylight saving without a table', () => {
    const winter = new Date('2026-01-15T09:00:00Z')
    const summer = new Date('2026-07-15T09:00:00Z')
    expect(clockIn(winter, 'America/Chicago')).toBe('03:00')
    expect(clockIn(summer, 'America/Chicago')).toBe('04:00')
  })
})
