'use client'

import { useEffect, useState } from 'react'

/**
 * mm:ss until the link dies. Purely informational: the real expiry is
 * auth.email.otp_expiry in supabase/config.toml, and this counts the same 15
 * minutes so the screen is not telling a different story than the server.
 */
export function Countdown({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds)

  useEffect(() => {
    const id = setInterval(() => setLeft((n) => (n > 0 ? n - 1 : 0)), 1000)
    return () => clearInterval(id)
  }, [])

  const mm = String(Math.floor(left / 60)).padStart(2, '0')
  const ss = String(left % 60).padStart(2, '0')

  return (
    <span className={left === 0 ? 'text-red-text' : 'text-label'}>{left === 0 ? 'expired' : `${mm}:${ss}`}</span>
  )
}
