'use client'

import { useState } from 'react'
import { MAX_CODE_LENGTH, MIN_CODE_LENGTH, normalizeCode } from '@/core/otp'

/**
 * The code field. One input rather than a box per digit: boxes need focus
 * management, paste splitting and backspace handling to behave, a phone
 * keyboard fills a single field correctly without any of it, and a row of six
 * boxes is a build that has decided how long the code is.
 *
 * autoComplete one-time-code is what makes iOS offer the code above the
 * keyboard instead of making the owner switch to Mail and back.
 *
 * It does not submit itself. The first build submitted on the sixth digit,
 * which silently truncated the 8 digit code this project actually issues and
 * reported the owner's correct code as wrong. Submitting on a length this app
 * has guessed is the bug, so the owner presses the button and Supabase decides
 * whether the code is right.
 */
export function CodeInput({ invalid }: { invalid: boolean }) {
  const [code, setCode] = useState('')

  return (
    <input
      id="code"
      name="code"
      // Not type="number": a spinner, a scroll wheel that changes the value,
      // and a leading zero that some browsers drop.
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      // The longest Supabase can issue, so a real code is never cut short.
      maxLength={MAX_CODE_LENGTH}
      minLength={MIN_CODE_LENGTH}
      autoFocus
      required
      placeholder="000000"
      aria-invalid={invalid || undefined}
      value={code}
      onChange={(event) => setCode(normalizeCode(event.target.value))}
      className={
        'num w-full rounded-control border bg-fill-3 px-3 py-3 text-center text-title-1 tracking-[0.28em] ' +
        'text-label outline-none placeholder:text-placeholder focus-visible:outline-solid focus-visible:outline-2 ' +
        'focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring) ' +
        (invalid ? 'border-red-text' : 'border-transparent')
      }
    />
  )
}
