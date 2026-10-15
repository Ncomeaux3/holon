import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// AES-256-GCM. Everything in core.connections goes through here, plus policy
// numbers and account identifiers. Authenticated, so a tampered row throws
// instead of decrypting to garbage.

const IV_BYTES = 12
const KEY_BYTES = 32

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    )
  }
  const parsed = Buffer.from(raw, 'base64')
  if (parsed.length !== KEY_BYTES) {
    throw new Error(`ENCRYPTION_KEY must decode to 32 bytes, got ${parsed.length}`)
  }
  return parsed
}

/** Returns iv:tag:ciphertext, each part base64. */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString('base64')).join(':')
}

export function decrypt(payload: string): string {
  const parts = payload.split(':')
  if (parts.length !== 3) {
    throw new Error('malformed ciphertext: expected iv:tag:ciphertext')
  }
  const [iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, 'base64'))

  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  // final() is what throws when the tag does not match.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
