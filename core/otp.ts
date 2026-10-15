// The code from the sign in email. Kept here, pure, so the rules about what
// counts as a code can be tested without a session or a server.
//
// The length is Supabase's to choose, not this app's. Email OTP Length is a
// project setting from 6 to 10, and a build that assumes 6 silently drops the
// end of an 8 digit code and tells the owner their correct code is wrong. That
// happened on 2026-09-14 and cost an evening: the field looked like it was
// working and the digits were gone before anything was submitted.

export const MIN_CODE_LENGTH = 6
export const MAX_CODE_LENGTH = 10

/**
 * What the owner typed, reduced to what Supabase will accept.
 *
 * Phones are the reason this exists. Mail's autofill hands over the code with
 * whatever punctuation surrounded it in the sentence, a paste from the message
 * brings a trailing space or a non breaking one, and some keyboards insert a
 * thin space every three digits. Every one of those is the right code typed by
 * a person who would then be told it was wrong.
 *
 * The cap is the longest code Supabase can issue, so it never truncates a real
 * one. It exists only so a paste of the whole email cannot become a guess.
 */
export function normalizeCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, MAX_CODE_LENGTH)
}

/**
 * A code worth spending a verification attempt on. Length is not checked
 * against an exact number because this app does not get to decide it: anything
 * from the shortest Supabase issues upward is plausible, and Supabase is the
 * one that says whether it is right.
 */
export function isCompleteCode(input: string): boolean {
  return normalizeCode(input).length >= MIN_CODE_LENGTH
}

/**
 * The verification types tried, in order, against one code.
 *
 * Supabase documents `email` for this flow. It does not work here. GoTrue
 * stores the code for a magic link to an existing user in the recovery token
 * column (confirmed on 2026-09-14: the row in `auth.one_time_tokens` came back
 * as `recovery_token`), and `/verify` only matches when the type it is handed
 * maps to the same column. With `email` alone every code was refused as
 * "token has expired or is invalid" 41 seconds after it was issued.
 *
 * Which type maps to that column is a GoTrue internal the docs do not pin
 * down, and the stored token is hashed so it cannot be tested from outside.
 * Encoding one guess is how the only way into this app breaks again the next
 * time that internal moves, so all three are tried and the first accepted one
 * wins. `magiclink` is first because it is what the evidence points at, so the
 * common case costs one call.
 *
 * A wrong code costs three refusals rather than one. That spends Supabase's
 * own verification limit three times as fast, which for a single owner makes
 * brute force harder rather than easier.
 */
export const VERIFY_TYPES = ['magiclink', 'email', 'recovery'] as const

export type VerifyType = (typeof VERIFY_TYPES)[number]

/**
 * Runs `attempt` for each type until one returns no error. `attempt` returns
 * the error or null, so this stays free of any Supabase type and can be tested
 * without a project.
 */
export async function verifyWithAnyType<E>(
  attempt: (type: VerifyType) => Promise<E | null>,
): Promise<{ ok: boolean; type: VerifyType | null; error: E | null }> {
  let last: E | null = null

  for (const type of VERIFY_TYPES) {
    const error = await attempt(type)
    if (!error) return { ok: true, type, error: null }
    last = error
  }

  return { ok: false, type: null, error: last }
}
