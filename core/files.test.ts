import { describe, expect, it } from 'vitest'
import { signedUrl, upload } from './files'

// Storage runs in the local Supabase container, so these are real uploads
// against a real bucket. What is worth proving is the boundary: a caller must
// not be able to write outside its own module.

const bytes = () => Buffer.from(`fixture ${Date.now()}`)

describe('upload', () => {
  it('refuses a path that climbs out of the bucket', async () => {
    await expect(upload('notes', '../health/labs.pdf', bytes())).rejects.toThrow(/relative path/i)
  })

  it('refuses an absolute path', async () => {
    await expect(upload('notes', '/etc/passwd', bytes())).rejects.toThrow(/relative path/i)
  })

  it('refuses a module id that is not one', async () => {
    await expect(upload('../public', 'x.txt', bytes())).rejects.toThrow(/module id/i)
  })

  it('stores a file and hands back a signed URL that expires', async () => {
    const file = await upload('notes', `test/${Date.now()}.txt`, bytes(), 'text/plain')
    expect(file.module).toBe('notes')

    const url = await signedUrl(file, 60)
    // Signed, not public: the token is what makes it readable at all.
    expect(url).toContain('/notes/')
    expect(url).toMatch(/token=/)
  })
})
