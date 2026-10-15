import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decrypt, encrypt } from './crypto'

const KEY_A = randomBytes(32).toString('base64')
const KEY_B = randomBytes(32).toString('base64')

beforeEach(() => {
  process.env.ENCRYPTION_KEY = KEY_A
})
afterEach(() => {
  delete process.env.ENCRYPTION_KEY
})

describe('encrypt and decrypt', () => {
  it('round trips a secret', () => {
    const secret = 'sk-ant-api03-not-a-real-key'
    expect(decrypt(encrypt(secret))).toBe(secret)
  })

  it('round trips unicode and empty strings', () => {
    expect(decrypt(encrypt(''))).toBe('')
    expect(decrypt(encrypt('née 🔐 café'))).toBe('née 🔐 café')
  })

  it('produces a different ciphertext every time, so equal secrets are not equal rows', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'))
  })

  it('emits iv:tag:ciphertext', () => {
    const parts = encrypt('x').split(':')
    expect(parts).toHaveLength(3)
    // 12 byte GCM iv and 16 byte tag.
    expect(Buffer.from(parts[0], 'base64')).toHaveLength(12)
    expect(Buffer.from(parts[1], 'base64')).toHaveLength(16)
  })
})

describe('tampering', () => {
  // GCM is authenticated: a changed byte anywhere must fail, not decrypt to junk.
  const flipFirstByte = (b64: string) => {
    const buf = Buffer.from(b64, 'base64')
    buf[0] ^= 0xff
    return buf.toString('base64')
  }

  it('rejects a modified ciphertext', () => {
    const [iv, tag, ct] = encrypt('sensitive').split(':')
    expect(() => decrypt(`${iv}:${tag}:${flipFirstByte(ct)}`)).toThrow()
  })

  it('rejects a modified auth tag', () => {
    const [iv, tag, ct] = encrypt('sensitive').split(':')
    expect(() => decrypt(`${iv}:${flipFirstByte(tag)}:${ct}`)).toThrow()
  })

  it('rejects a modified iv', () => {
    const [iv, tag, ct] = encrypt('sensitive').split(':')
    expect(() => decrypt(`${flipFirstByte(iv)}:${tag}:${ct}`)).toThrow()
  })

  it('rejects a payload that is not three parts', () => {
    expect(() => decrypt('only:two')).toThrow(/malformed/i)
    expect(() => decrypt('')).toThrow(/malformed/i)
  })
})

describe('keys', () => {
  it('cannot decrypt with a different key', () => {
    const payload = encrypt('sensitive')
    process.env.ENCRYPTION_KEY = KEY_B
    expect(() => decrypt(payload)).toThrow()
  })

  it('refuses to run without ENCRYPTION_KEY', () => {
    delete process.env.ENCRYPTION_KEY
    expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY/)
  })

  it('refuses a key that is not 32 bytes', () => {
    process.env.ENCRYPTION_KEY = randomBytes(16).toString('base64')
    expect(() => encrypt('x')).toThrow(/32 bytes/)
  })
})
