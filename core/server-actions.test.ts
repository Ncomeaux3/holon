import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A Server Action is a standalone POST endpoint addressed by an opaque id. The
 * (app) layout's requireOwner() does NOT run for one, so a layout gate protects
 * pages and nothing else. Every action has to authenticate itself.
 *
 * This is easy to forget and invisible in the browser, so it is checked here
 * rather than left to review. Every module page with a form will hit it.
 */

// The only actions allowed to skip the gate, with the reason they are safe.
const PRE_AUTH_ACTIONS: Record<string, string> = {
  // The sign in form itself. It cannot require a session, and it gates on
  // ownerVerdict() so only the owner's address is ever sent a link.
  'app/(auth)/login/page.tsx:sendMagicLink': 'the login form, pre-auth by design',
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : []
  })
}

type Action = { file: string; name: string; body: string }

function serverActions(): Action[] {
  const found: Action[] = []

  for (const file of walk('app')) {
    const source = readFileSync(file, 'utf8')
    if (!source.includes("'use server'")) continue

    // Split on function declarations and keep each body up to the next one.
    const starts = [...source.matchAll(/async function (\w+)\s*\([^)]*\)\s*\{/g)]
    starts.forEach((match, i) => {
      const from = match.index!
      const to = i + 1 < starts.length ? starts[i + 1].index! : source.length
      const body = source.slice(from, to)
      if (body.includes("'use server'")) found.push({ file, name: match[1], body })
    })
  }

  return found
}

describe('server actions', () => {
  const actions = serverActions()

  it('finds the actions at all, so a broken scan cannot pass vacuously', () => {
    expect(actions.length).toBeGreaterThanOrEqual(5)
  })

  it.each(actions.map((a) => [`${a.file}:${a.name}`, a] as const))(
    '%s authenticates the caller',
    (key, action) => {
      if (key in PRE_AUTH_ACTIONS) {
        expect(action.body).toContain('ownerVerdict')
        return
      }
      expect(
        action.body,
        `${key} is a public POST endpoint until it calls requireOwner()`,
      ).toContain('requireOwner()')
    },
  )

  // The scan only understands `async function name()`. An inline action would
  // slip past it silently, so fail loudly instead of quietly under-checking.
  it('uses no inline server action the scan cannot see', () => {
    for (const file of walk('app')) {
      const source = readFileSync(file, 'utf8')
      if (!source.includes("'use server'")) continue
      expect(source, `${file} declares an inline server action`).not.toMatch(
        /=>\s*\{\s*['"]use server['"]/,
      )
    }
  })
})
