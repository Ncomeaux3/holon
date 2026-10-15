import Link from 'next/link'
import { LEGAL_DOCS } from '@/core/legal'
import { ActionButton, Eyebrow, HolonLockup, fieldClass } from '@/components/pos'
import { HIT } from '@/components/pos/button-classes'
import { cn } from '@/lib/utils'
import { sendCode, verifyCode } from './actions'
import { CodeInput } from './CodeInput'
import { Countdown } from './Countdown'
import { PasskeyButton } from './PasskeyButton'
import { SubmitButton } from './SubmitButton'

// Matches supabase/config.toml auth.email.otp_expiry.
const CODE_TTL_SECONDS = 900

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams
  const sent = params.sent === '1'
  const error = typeof params.error === 'string' ? params.error : null

  // Reflected onto the page, so it is only shown when it really is an address.
  const raw = typeof params.email === 'string' ? params.email : ''
  const email = EMAIL.test(raw) && raw.length <= 254 ? raw : ''

  return (
    <div className="flex min-h-dvh flex-col">
      {/* The top band: the lockup, and what this install is. */}
      <header className="flex h-16 shrink-0 flex-wrap items-center justify-between gap-3 px-7">
        <HolonLockup size={32} />
        <Eyebrow>Single owner</Eyebrow>
      </header>

      <main className="grid flex-1 place-items-center p-6">
      <div className="w-full max-w-[440px] rounded-card bg-grouped-2 p-9 pb-7">
        {sent ? (
          <div className="space-y-5">
            <div className="space-y-3">
              <Eyebrow dot="ok">Code sent</Eyebrow>
              <h1 className="text-large-title font-bold text-label">Enter the code</h1>
              <p className="text-footnote text-secondary-label">
                If that address owns this install, a sign in code is on its way
                {email && (
                  <>
                    {' '}
                    to <span className="text-label">{email}</span>
                  </>
                )}
                .
              </p>
            </div>

            {/* The code is typed into the window that asked for it, so the
              * session lands in this browser. That is the whole reason this
              * screen exists: a link tapped in a mail app opens somewhere
              * else, and on a phone somewhere else is a different cookie jar.
              */}
            <form action={verifyCode} className="space-y-3">
              <input type="hidden" name="email" value={email} />
              <label htmlFor="code" className="label block text-secondary-label">
                Sign in code
              </label>
              <CodeInput invalid={error === 'code'} />
              {error === 'code' && (
                <p className="label text-red-text">
                  That code is wrong or expired. Enter all of it, or ask for another.
                </p>
              )}
              <div className="flex justify-end pt-1">
                <SubmitButton idle="Sign in" busy="Checking" />
              </div>
            </form>

            <div className="flex items-baseline justify-between border-y border-separator py-3">
              <span className="label text-secondary-label">Expires</span>
              <span className="num text-footnote">
                <Countdown seconds={CODE_TTL_SECONDS} />
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link href="/login" className={`${HIT} inline-block text-footnote text-secondary-label transition-colors hover:text-label`}>
                Use a different email
              </Link>
              <form action={sendCode}>
                <input type="hidden" name="email" value={email} />
                <ActionButton variant="quiet" size="sm" type="submit">
                  Resend
                </ActionButton>
              </form>
            </div>

            <p className="text-footnote text-secondary-label">
              The same email carries a link. It signs in the browser that opens it, so use it on
              the machine that asked and the code everywhere else.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* The artboard's order: what you are doing is the eyebrow, what
              * you are signing in to is the heading. */}
            <div className="space-y-3">
              <Eyebrow>Sign in</Eyebrow>
              <h1 className="text-large-title font-bold text-label">
                Your life. One system.
              </h1>
              <p className="text-footnote text-secondary-label">
                One owner, one login. Use the passkey on this device, or have a sign in code sent
                to the owner email.
              </p>
            </div>

            {/* Renders only where the browser can do WebAuthn, and only after
              * hydration, so the email form below is never gated on it. */}
            <PasskeyButton />

            <form action={sendCode} className="space-y-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="email"
                  className="label block text-secondary-label"
                >
                  Owner email
                </label>
                <div className="flex items-center gap-2 rounded-control bg-fill-3 px-3.5 focus-within:outline-solid focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-(--focus-ring)">
                  <span aria-hidden className="code text-footnote text-secondary-label">
                    &gt;
                  </span>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="username webauthn"
                    required
                    placeholder="you@yourdomain.com"
                    defaultValue={error === 'invalid' ? raw : ''}
                    className={cn(fieldClass, 'bg-transparent px-0 focus-visible:outline-none')}
                  />
                </div>
                {error === 'invalid' && (
                  <p className="label text-red-text">
                    Enter a valid email
                  </p>
                )}
                {error === 'expired' && (
                  <p className="label text-red-text">
                    That link expired, or it opened in a different browser than the one that asked
                    for it. Send a code instead.
                  </p>
                )}
                {error === 'missing_code' && (
                  <p className="label text-red-text">
                    That link was incomplete. Send a code instead.
                  </p>
                )}
              </div>

              <div className="flex justify-end pt-2">
                <SubmitButton idle="Send sign-in code" busy="Sending" />
              </div>
            </form>

            <div className="flex flex-wrap justify-between gap-2 border-t border-separator pt-3">
              <span className="label text-secondary-label">
                Code expires in 15 min
              </span>
              <span className="label text-secondary-label">
                No passwords · no signup
              </span>
            </div>
          </div>
        )}
      </div>
      </main>

      <footer className="flex flex-wrap justify-center gap-x-5 gap-y-2 px-4 pb-6">
        {LEGAL_DOCS.map((d) => (
          <Link key={d.href} href={d.href} className={`${HIT} inline-block text-footnote text-secondary-label underline-offset-4 hover:text-label hover:underline`}>
            {d.label}
          </Link>
        ))}
      </footer>
    </div>
  )
}
