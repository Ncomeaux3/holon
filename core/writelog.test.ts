import { describe, expect, it } from 'vitest'
import { db } from './db'
import { patchRule } from './notify'
import { duration, summarise, type Entry, type Job } from './writelog-shape'

const entry = (module: string, label: string): Entry => ({
  id: label,
  module,
  moduleLabel: label,
  tool: 'write',
  kind: 'CREATED',
  title: 'something',
  reason: 'because',
  diff: [],
  time: '04:01',
  undone: false,
  canUndo: true,
  canRedo: false,
})

const job = (name: string, status: Job['status']): Job => ({
  module: 'finance',
  name,
  status,
  durationMs: 1000,
})

describe('duration', () => {
  it('reads seconds under a minute and minutes over one', () => {
    expect(duration(48_000)).toBe('48s')
    expect(duration(221_000)).toBe('3m 41s')
    expect(duration(60_000)).toBe('1m 00s')
    expect(duration(null)).toBe('--')
  })
})

describe('summarise', () => {
  it('says a quiet run was quiet rather than showing nothing', () => {
    expect(summarise([], [])).toBe('No writes. Nothing needed changing.')
  })

  it('names the failure when a quiet run was not actually quiet', () => {
    expect(summarise([], [job('Brokerage sync', 'failed')])).toBe('No writes. 1 job failed.')
  })

  it('lists the modules it touched', () => {
    const entries = [entry('finance', 'Finance'), entry('tasks', 'Tasks'), entry('goals', 'Goals')]
    expect(summarise(entries, [])).toBe('3 writes across Finance, Tasks and Goals.')
  })

  it('names a failed job alongside the writes that did land', () => {
    expect(summarise([entry('finance', 'Finance')], [job('Brokerage sync', 'failed')])).toBe(
      '1 write across Finance. Brokerage sync failed and was skipped.',
    )
  })
})

/**
 * patchRule builds its SET clause by interpolating column names, and it is
 * reached from a server action, which is a public POST endpoint that accepts
 * whatever it is sent. The TypeScript signature is erased at runtime, so the
 * runtime whitelist is the only thing standing between a caller and any column
 * on the table.
 */
describe('patchRule', () => {
  it('writes the columns it is allowed to write', async () => {
    const { rows } = await db().query<{ id: string }>(
      `select id from core.notification_rules where module = 'finance' and key = 'budget_pacing'`,
    )
    const id = rows[0].id

    await patchRule(id, { muted: true, timing: 'evening' })

    const { rows: after } = await db().query<{ muted: boolean; timing: string }>(
      `select muted, timing from core.notification_rules where id = $1`,
      [id],
    )
    expect(after[0]).toEqual({ muted: true, timing: 'evening' })

    await patchRule(id, { muted: false, timing: 'morning' })
  })

  it('ignores a key that is not a patchable column', async () => {
    const { rows } = await db().query<{ id: string; label: string }>(
      `select id, label from core.notification_rules where module = 'system' and key = 'job_failed'`,
    )
    const { id, label } = rows[0]

    // A hostile key would close the assignment and open another one, writing a
    // column no caller should reach.
    await patchRule(id, { "muted = true, label": 'owned' } as never)

    const { rows: after } = await db().query<{ label: string; muted: boolean }>(
      `select label, muted from core.notification_rules where id = $1`,
      [id],
    )
    expect(after[0].label).toBe(label)
    expect(after[0].muted).toBe(false)
  })
})
