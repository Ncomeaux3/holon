import { describe, expect, it } from 'vitest'
import { projectCharges, rollForward, toCalendarItems } from './calendar'

describe('projectCharges', () => {
  it('clamps a month end charge and re-anchors past a short month', () => {
    // The 31st lands on 28 Feb, then back on 31 March, not 28 March.
    const dates = projectCharges('monthly', '2026-01-31', '2026-04-30').map((o) => o.date)
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })

  it('steps weekly across the range', () => {
    const dates = projectCharges('weekly', '2026-09-01', '2026-09-22').map((o) => o.date)
    expect(dates).toEqual(['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22'])
  })

  it('steps yearly and clamps a leap day anchor', () => {
    const dates = projectCharges('yearly', '2028-02-29', '2030-03-01').map((o) => o.date)
    expect(dates).toEqual(['2028-02-29', '2029-02-28', '2030-02-28'])
  })

  it('steps quarterly and every six months, clamping a month end', () => {
    expect(projectCharges('quarterly', '2026-11-30', '2027-06-01').map((o) => o.date)).toEqual([
      '2026-11-30', '2027-02-28', '2027-05-30',
    ])
    expect(projectCharges('semiannual', '2026-08-31', '2027-09-01').map((o) => o.date)).toEqual([
      '2026-08-31', '2027-02-28', '2027-08-31',
    ])
  })

  it('marks only the first occurrence not projected', () => {
    const occ = projectCharges('monthly', '2026-09-05', '2026-11-05')
    expect(occ[0].projected).toBe(false)
    expect(occ.slice(1).every((o) => o.projected)).toBe(true)
  })
})

describe('rollForward', () => {
  it('moves a passed charge to its first date on or after today', () => {
    expect(rollForward('semiannual', '2026-03-14', '2026-10-14')).toBe('2027-03-14')
    expect(rollForward('quarterly', '2026-07-14', '2026-10-14')).toBe('2026-10-14')
  })

  it('leaves a charge still ahead where it is', () => {
    expect(rollForward('yearly', '2027-01-02', '2026-10-14')).toBe('2027-01-02')
  })
})

describe('toCalendarItems', () => {
  it('drops an occurrence before the range and titles it the merchant', () => {
    const items = toCalendarItems(
      [{ id: 'r1', merchant: 'Claude Pro', cadence: 'monthly', next_charge_on: '2026-08-05' }],
      { from: '2026-09-01', to: '2026-09-30' },
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      title: 'Claude Pro',
      startsAt: '2026-09-05',
      allDay: true,
      kind: 'charge',
      href: '/finance?tab=subscriptions',
    })
  })
})
