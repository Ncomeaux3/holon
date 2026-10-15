import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The first test in the repo. It is not a placeholder: local, CI, and Vercel all
// have to agree on the Node major, and these three drift silently otherwise.
describe('node version', () => {
  const nvmrc = readFileSync('.nvmrc', 'utf8').trim()
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

  it('pins the same major in .nvmrc and package.json engines', () => {
    expect(pkg.engines.node).toBe(`${nvmrc}.x`)
  })

  it('runs tests on that major', () => {
    expect(process.versions.node.split('.')[0]).toBe(nvmrc)
  })
})
