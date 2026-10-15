import { describe, expect, it } from 'vitest'
import { ATTACH_INPUT } from './manifest'

const policy = '6d7f2a1e-9b3c-4e5f-8a1b-2c3d4e5f6a7b'
const other = '0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d'

describe('attach_document input', () => {
  it('takes a file directly under the policy prefix', () => {
    expect(ATTACH_INPUT.safeParse({ policy_id: policy, name: 'a.pdf', file_path: `${policy}/1-a.pdf` }).success).toBe(true)
  })

  it('rejects another policy prefix, a traversal and a nested path', () => {
    for (const file_path of [`${other}/1-a.pdf`, `${policy}/../${other}/a.pdf`, `${policy}/x/a.pdf`, 'drafts/a.pdf']) {
      expect(ATTACH_INPUT.safeParse({ policy_id: policy, name: 'a.pdf', file_path }).success).toBe(false)
    }
  })
})
