import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/core/settings'

// The script itself is exercised by running it; what is worth a test is the two
// contracts it depends on staying true, because both fail silently otherwise.

const ROOT = path.join(import.meta.dirname, '..')

describe('setup preconditions', () => {
  it('names every setting default in .env.example or in DEFAULT_SETTINGS, not both', () => {
    const example = readFileSync(path.join(ROOT, '.env.example'), 'utf8')
    const envKeys = new Set([...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]))

    // A value that lives in both places has two sources of truth and will drift.
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      expect(envKeys.has(key.toUpperCase()), `${key} is in both .env.example and settings`).toBe(
        false,
      )
    }
  })

  it('has a package script for setup and for the demo seed', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }

    // pnpm swallows a bare --demo, so the demo seed needs its own script rather
    // than a documented `pnpm setup -- --demo`.
    expect(pkg.scripts.setup).toContain('scripts/setup.ts')
    expect(pkg.scripts['setup:demo']).toContain('--demo')
  })

  it('keeps every xp weight a number, because a string silently scores zero', () => {
    const file = readFileSync(path.join(ROOT, 'modules', 'skills', 'xp.yaml'), 'utf8')
    const weights = [...file.matchAll(/^\s{2}([a-z_]+):\s*(\S+)\s*$/gm)]

    expect(weights.length).toBeGreaterThan(0)
    for (const [, name, value] of weights) {
      expect(Number.isFinite(Number(value)), `${name} is ${value}`).toBe(true)
    }
  })
})
