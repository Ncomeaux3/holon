import { describe, expect, it } from 'vitest'
import {
  annualCents,
  byType,
  cadenceTag,
  daysLabel,
  daysUntil,
  expiryLabel,
  leadsLabel,
  maskNumber,
  nextTermEnd,
  paymentSchedule,
  premiumPost,
  policyStatus,
  reminderMarks,
  remindersDueToday,
  shortDate,
} from './premium'

describe('byType', () => {
  it('sums active policies per kind and leaves the car out of health', () => {
    const policies = [
      { kind: 'health', status: 'active', premium_cents: 32_000, cadence: 'monthly', expires_on: '2026-12-31' },
      { kind: 'dental', status: 'active', premium_cents: 4_000, cadence: 'monthly', expires_on: '2026-10-05' },
      { kind: 'auto', status: 'active', premium_cents: 90_000, cadence: 'semiannual', expires_on: '2027-03-01' },
      { kind: 'health', status: 'cancelled', premium_cents: 50_000, cadence: 'monthly', expires_on: null },
    ]
    expect(byType(policies, '2026-09-20')).toEqual({
      health: { annualCents: 384_000, active: 1, expiring: 0 },
      dental: { annualCents: 48_000, active: 1, expiring: 1 },
      auto: { annualCents: 180_000, active: 1, expiring: 0 },
    })
  })
})

describe('annualCents', () => {
  it('multiplies by how often the cadence bills', () => {
    expect(annualCents(1_349, 'monthly')).toBe(16_188)
    expect(annualCents(61_200, 'semiannual')).toBe(122_400)
    expect(annualCents(50_000, 'annual')).toBe(50_000)
  })
})

describe('policyStatus', () => {
  const today = '2026-09-08'

  it('separates no date on file from expired', () => {
    // Nobody has written the date down. Calling that active would be a claim
    // the screen has no evidence for.
    expect(policyStatus(null, today)).toBe('undated')
    expect(policyStatus('2026-09-07', today)).toBe('expired')
  })

  it('escalates as the date comes closer', () => {
    expect(policyStatus('2026-12-01', today)).toBe('active')
    expect(policyStatus('2026-11-01', today)).toBe('expiring')
    expect(policyStatus('2026-09-30', today)).toBe('renew-now')
    expect(policyStatus('2026-09-08', today)).toBe('renew-now')
  })
})

describe('maskNumber', () => {
  it('masks the same way however the number is punctuated', () => {
    expect(maskNumber('918-44-2210-8')).toBe('•••• 2108')
    expect(maskNumber('918442210 8')).toBe('•••• 2108')
  })

  it('says so rather than masking nothing', () => {
    expect(maskNumber('')).toBe('not on file')
  })
})

describe('nextTermEnd', () => {
  it('renews a six month policy to six months on and everything else to a year', () => {
    expect(nextTermEnd('2026-11-14', 'semiannual')).toBe('2027-05-14')
    expect(nextTermEnd('2026-11-14', 'monthly')).toBe('2027-11-14')
  })

  it('clamps to the end of a shorter month', () => {
    expect(nextTermEnd('2026-08-31', 'semiannual')).toBe('2027-02-28')
  })
})

describe('daysUntil and expiryLabel', () => {
  it('counts whole days either side of today', () => {
    expect(daysUntil('2026-10-14', '2026-09-08')).toBe(36)
    expect(daysUntil('2026-09-01', '2026-09-08')).toBe(-7)
    expect(expiryLabel('2026-10-14', '2026-09-08')).toBe('in 36 days')
    expect(expiryLabel('2026-09-01', '2026-09-08')).toBe('7 days ago')
    expect(expiryLabel(null, '2026-09-08')).toBe('no date on file')
  })
})

describe('remindersDueToday', () => {
  it('fires a lead only on the day it lands', () => {
    expect(remindersDueToday('2026-11-07', [60, 30, 7], '2026-09-08')).toEqual([60])
    expect(remindersDueToday('2026-11-07', [60, 30, 7], '2026-09-09')).toEqual([])
  })

  it('says nothing about a policy that has already expired', () => {
    // The reminder is for a renewal that has not happened. Once the date has
    // passed, the row on the screen is the message.
    expect(remindersDueToday('2026-09-01', [60, 30, 7], '2026-09-08')).toEqual([])
  })
})

describe('the screen strings', () => {
  const today = '2026-09-11'

  it('shortDate writes the year only when it is not this one', () => {
    expect(shortDate('2026-10-18', today)).toBe('Oct 18')
    expect(shortDate('2027-01-02', today)).toBe('Jan 2 2027')
  })

  it('daysLabel counts down, then counts back', () => {
    expect(daysLabel('2026-10-18', today)).toBe('37 days')
    expect(daysLabel('2026-09-11', today)).toBe('today')
    expect(daysLabel('2026-08-30', today)).toBe('12d ago')
    expect(daysLabel(null, today)).toBe('no date')
  })

  it('cadenceTag and leadsLabel', () => {
    expect(cadenceTag('monthly')).toBe('/mo')
    expect(cadenceTag('quarterly')).toBe('/3mo')
    expect(cadenceTag('semiannual')).toBe('/6mo')
    expect(cadenceTag('annual')).toBe('/yr')
    expect(leadsLabel([14, 60, 0])).toBe('60d · 14d · day of')
    expect(leadsLabel([])).toBe('off')
  })
})

describe('reminderMarks', () => {
  it('places each lead on the track from today to the expiry', () => {
    expect(reminderMarks([60, 14], 113)).toEqual([
      { lead: 60, at: 46.9, fired: false },
      { lead: 14, at: 87.6, fired: false },
    ])
  })

  it('a lead that has passed sits at the start, fired', () => {
    expect(reminderMarks([60], 37)).toEqual([{ lead: 60, at: 0, fired: true }])
  })

  it('an expired policy puts every mark at the start', () => {
    expect(reminderMarks([30, 0], -5)).toEqual([
      { lead: 30, at: 0, fired: true },
      { lead: 0, at: 100, fired: true },
    ])
  })
})

describe('paymentSchedule', () => {
  it('steps back from the expiry by the cadence: one behind, three ahead', () => {
    expect(paymentSchedule('2026-10-18', 'monthly', '2026-09-11')).toEqual([
      { label: 'Last', on: '2026-08-18' },
      { label: 'Next', on: '2026-09-18' },
      { label: 'Upcoming', on: '2026-10-18' },
      { label: 'Upcoming', on: '2026-11-18' },
    ])
  })

  it('six months apart for a semiannual policy', () => {
    expect(paymentSchedule('2027-01-02', 'semiannual', '2026-09-11').map((p) => p.on)).toEqual([
      '2026-07-02', '2027-01-02', '2027-07-02', '2028-01-02',
    ])
  })

  it('keeps the day of month where the month is shorter', () => {
    expect(paymentSchedule('2026-03-31', 'monthly', '2026-03-01').map((p) => p.on)).toEqual([
      '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31',
    ])
  })
})

describe('premiumPost', () => {
  const policy = {
    id: 'p1', name: 'Auto', premium_cents: 61_200, cadence: 'semiannual' as const,
    expires_on: '2027-03-14', status: 'active', post_to_finance: true,
  }

  it('posts the premium on its next billing date, filed under Insurance premiums', () => {
    expect(premiumPost(policy, '2026-10-14')).toEqual({
      source: 'insurance', external_id: 'p1', name: 'Auto', amount_cents: 61_200,
      cadence: 'semiannual', last_charge_on: '2026-09-14', next_charge_on: '2027-03-14',
      category: 'Insurance premiums',
    })
  })

  it('names an annual premium the way Finance does', () => {
    expect(premiumPost({ ...policy, cadence: 'annual' }, '2026-10-14')?.cadence).toBe('yearly')
  })

  it('posts nothing when it is off, lapsed, undated or free', () => {
    expect(premiumPost({ ...policy, post_to_finance: false }, '2026-10-14')).toBeNull()
    expect(premiumPost({ ...policy, status: 'lapsed' }, '2026-10-14')).toBeNull()
    expect(premiumPost({ ...policy, expires_on: null }, '2026-10-14')).toBeNull()
    expect(premiumPost({ ...policy, premium_cents: 0 }, '2026-10-14')).toBeNull()
  })

  it('posts nothing for cover that has ended unrenewed', () => {
    expect(premiumPost({ ...policy, expires_on: '2026-10-13' }, '2026-10-14')).toBeNull()
    expect(premiumPost({ ...policy, expires_on: '2026-10-14' }, '2026-10-14')).not.toBeNull()
  })
})
