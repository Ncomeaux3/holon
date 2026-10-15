import { expect, test as setup } from '@playwright/test'

// Signing in for real rather than minting a session, through the code path
// because that is what the app leads with now. It is also the path worth
// guarding: the link broke on the phone precisely because it left the browser
// that asked for it, and a code typed into this page cannot.

const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:54324'
const STATE = 'e2e/.auth/owner.json'
// The same default the config uses. Hardcoding port 3000 here meant the setup
// project failed on any run pointed elsewhere, which is what forced every run
// on a machine with something already on 3000 to pass --no-deps and skip
// signing in at all.
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

type MailpitSummary = { ID: string }

async function messagesFor(email: string): Promise<MailpitSummary[]> {
  const list = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}&limit=5`)
  if (!list.ok) return []
  const { messages = [] } = (await list.json()) as { messages?: MailpitSummary[] }
  return messages
}

// New means an ID not seen before the form was sent, not a Created time after
// it: Mailpit stamps mail with the Docker VM's clock, which drifts behind the
// laptop's under load (7 s measured), and a time filter then rejects every
// fresh message as old.
async function newestCodeFor(email: string, seen: Set<string>): Promise<string | null> {
  for (const m of await messagesFor(email)) {
    if (seen.has(m.ID)) continue

    const body = await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)
    if (!body.ok) continue

    const { Text = '', HTML = '' } = (await body.json()) as { Text?: string; HTML?: string }
    // A run of 6 to 10 digits standing alone, because Email OTP Length is a
    // project setting and this must not assume 6. The link in the same email
    // holds long hex tokens, so the digit boundaries are what keep them out.
    const match = `${Text}\n${HTML}`.match(/(?<!\d)\d{6,10}(?!\d)/)
    if (match) return match[0]
  }
  return null
}

setup('sign in as the owner', async ({ page }) => {
  const email = process.env.OWNER_EMAIL
  expect(email, 'OWNER_EMAIL must be set in .env').toBeTruthy()

  // Anything already in the mailbox is from an earlier run.
  const seen = new Set((await messagesFor(email!)).map((m) => m.ID))

  await page.goto('/login')
  await page.getByLabel(/owner email/i).fill(email!)
  await page.getByRole('button', { name: /^send/i }).click()
  await expect(page).toHaveURL(/sent=1/)

  // Sixty seconds, not ten. The mail usually lands in under a second, but on a
  // cold start the dev server is compiling routes while GoTrue is sending, and
  // a run once failed here with the message already in Mailpit a moment later.
  let code: string | null = null
  for (let i = 0; i < 120 && !code; i++) {
    code = await newestCodeFor(email!, seen)
    if (!code) await page.waitForTimeout(500)
  }
  expect(code, 'no sign in code arrived in Mailpit within 60s').toBeTruthy()

  await page.getByLabel(/sign in code/i).fill(code!)
  await page.getByRole('button', { name: /^sign in$/i }).click()
  await expect(page).toHaveURL(`${BASE_URL}/`)

  await page.context().storageState({ path: STATE })
})
