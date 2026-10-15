# Setting up the hosted Supabase project

Step 15, the last of Phase 1. This is the walkthrough for going from a Supabase
account with no project to a live POS you can reach from your phone.

Nothing in the codebase blocks this. Everything below is account work, and I
cannot do it for you because it needs your login and your card details.

Budget about 40 minutes, most of it waiting for a project to provision and for
Vercel to build.

**Read the whole of step 5 before you start.** It is the one that the security
review flagged, and it is much easier to set correctly than to notice later.

---

## 1. Create the project

At [supabase.com/dashboard](https://supabase.com/dashboard), **New project**.

| Field | What to put | Why |
|---|---|---|
| Name | `pos` | Matches the repo. Nothing reads it. |
| Database password | Generate one, save it to your password manager immediately | It is shown once. You need it in step 3, and resetting it later means re-doing step 6. |
| Region | The one closest to you | Every page load is a round trip. Pick by where you sit, not where your users are, because you are the only user. |
| Plan | Free | The whole app is inside the free tier. See the note below. |

**On the free tier and pausing.** A free project pauses after 7 days with no
activity. That will not happen here: the Vercel cron hits the database every
morning, which counts as activity. It does mean that if you stop the cron for a
holiday, you may come back to a paused project. Unpausing is one click.

Wait for provisioning to finish, roughly two minutes.

---

## 2. Collect the six values

Everything you need is behind two buttons. Open a scratch file and paste as you
go, because you will use each of these twice: once in `.env` locally, once in
Vercel.

**From Project Settings > API keys:**

- `NEXT_PUBLIC_SUPABASE_URL` is the Project URL, `https://<ref>.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` is the anon / publishable key
- `SUPABASE_SERVICE_ROLE_KEY` is the service role / secret key

The service role key bypasses row level security completely. It belongs in
Vercel's environment and in your local `.env` and nowhere else, never in a
client component and never in the repo.

**From the Connect button at the top of the dashboard:**

- `DATABASE_URL` is a **pooler** string: the Transaction pooler on port
  `6543`, or the Session pooler on port `5432`, which is what production has
  run on since 2026-09-13 and what the backup workflow uses. Either one. The
  user in both is `postgres.<project-ref>`, not `postgres`.

Take a pooler, not the direct connection. Vercel functions are short lived and
open a connection each, which is exactly what a pooler is for; the direct
connection is IPv6 only on the free tier and fails from Vercel (`ENOTFOUND`)
and from most home networks (`EHOSTUNREACH`), both seen on 2026-09-13.

The usual objection to transaction mode is that it does not support prepared
statements. I checked: this app never names a query, so `pg` never prepares one.
Transaction mode is safe here.

Substitute your database password into the string where it says
`[YOUR-PASSWORD]`.

---

## 3. Link the CLI and push the schema

From the repo root:

```bash
supabase login                          # opens a browser, stores a token
supabase link --project-ref <your-ref>  # the ref is in the dashboard URL
```

It will ask for the database password from step 1.

Then push all 27 migrations:

```bash
supabase db push
```

`db push` defaults to the linked remote, so no flag is needed. It lists what it
is about to apply and asks before it does. Expect 27 files, `core_init` first.

**Never run `supabase db reset` against the linked project.** It is the local
command. On a linked project it would drop everything. `db push` is the only
command you need here, now and for every future migration.

Verify:

```bash
supabase migration list --linked
```

Local and remote columns should match, 27 rows.

---

## 4. Fill in the production environment

Copy `.env` to something like `.env.production.local` (it is gitignored) or just
keep the scratch file. You need every key from `.env.example`. Four of them are
generated rather than looked up:

```bash
# Encrypts every provider credential in core.connections.
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Protects /api/cron/nightly and the dashboard's Run now button.
openssl rand -hex 32

# Bearer token for /api/mcp, which is how Claude Code reaches the app.
openssl rand -hex 32

# Web push, both keys at once.
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

**Generate a new `ENCRYPTION_KEY` for production. Do not reuse the local one.**
It encrypts `core.connections`, and the two databases hold different rows.
Reusing it buys nothing and spreads one key across two places. The consequence
is that production starts with no provider connections, which is correct: you
will paste those in at step 7.

Losing this key makes every stored credential unreadable, with no recovery. Put
it in your password manager before you paste it into Vercel.

`OWNER_EMAIL` is the only address allowed to log in. Everything else is
rejected before a page renders.

---

## 5. The two settings the security review flagged

This is the important step.

Every row level security policy in this app is `for all to authenticated`. That
distinguishes "signed in" from "not signed in" and nothing else, because there
is one user and an ownership column would be dead weight. It is the right call
for a single-user app **and it depends on two dashboard settings that the repo
cannot enforce.**

**a. Disable signup.** Authentication > Sign In / Providers > turn
**Allow new users to sign up** off.

Without this, anyone who finds the URL can create an account. That account would
be `authenticated`, and `authenticated` is what every policy trusts. The app
itself would still reject them at `requireOwner()`, but the Data API would not.

**b. Lock the exposed schemas.** Project Settings > API > **Exposed schemas**
must list only `public` and `graphql_public`.

Never add `core` or any module schema. If `core` were exposed, a signed-in
session could read `core.connections` straight over PostgREST, and that table
holds every provider credential you own. The app never uses PostgREST for module
data, so there is nothing to gain by exposing them.

`supabase/config.toml` already sets both correctly for the local stack. That
file does not travel to the hosted project, which is exactly why this step
exists.

While you are in Authentication > URL Configuration, set **Site URL** to your
Vercel production URL once you have it, and add it to redirect URLs. The magic
link will not come back to the right place otherwise.

---

## 6. Bootstrap the owner

With the production values in `.env.production`, from the repo root:

```bash
pnpm tsx --env-file=.env.production scripts/setup.ts
```

`pnpm setup` itself is pinned to `.env`, which is the local stack, so the
script is called directly with the production file. It refuses to start if any
key from `.env.example` is blank, and it needs the legacy `service_role` JWT
(Project Settings > API Keys > Legacy tab), not an `sb_secret_` key, for the
Auth admin call that creates the owner.

This is idempotent and safe to re-run. It creates the owner user from
`OWNER_EMAIL`, seeds `core.settings`, and writes the XP weights. It does not
create demo data. `pnpm setup:demo` does that, and you do not want it in
production.

**Set your timezone** once the app is up, on Settings > General. Everything that
asks "what day is it" goes through `core.today()`, which reads that setting
rather than the server clock. The database runs in UTC and Vercel runs wherever
it runs, so at 19:14 in Chicago those are different dates and a task due today
would look overdue.

---

## 7. Deploy to Vercel

The Vercel project `pos` already exists (verified 2026-09-12): it was imported
from GitHub on 2026-09-09, deploys every push, and production is
`https://pos-gilt-rho.vercel.app`. What is left is settings and environment.

**Node.js version: 22.x**, under Settings > General. Vercel defaulted to 24;
the repo's `engines`, `.nvmrc` and CI are all 22, and one runtime everywhere
is the point.

**Deployment Protection**, under Settings > Deployment Protection: Vercel
Authentication for **preview deployments only**, off for production
(decision 2026-09-12). With it on for every domain, production sat behind a
Vercel login before the app's own login, which breaks the magic link on a
phone and the PWA. Production's gate is `OWNER_EMAIL`, disabled signup and
RLS, which is step 5.

Paste every environment variable from step 4 into the Production environment
before redeploying. A build with a missing key succeeds and then fails at
runtime with `X is not set`, which is a slower way to find the same problem.
`RESEND_FROM` may stay unset; the digest sends from `onboarding@resend.dev`.

The cron is already declared in `vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/nightly", "schedule": "0 9 * * *" }] }
```

Vercel cron schedules are **UTC**. `0 9 * * *` is 09:00 UTC, which is 03:00 or
04:00 in Chicago depending on daylight saving. That is deliberate: it runs while
you are asleep so the dashboard is written before you look at it. Change the
hour in `vercel.json` if you want it elsewhere; there is no timezone field.

Hobby plan allows one cron a day, which is what this uses.

After the deploy, go back to Supabase Authentication > URL Configuration and set
Site URL to the production domain.

**Rolling back.** Code rolls back on Vercel: Deployments > the previous READY
deployment > Promote to Production, which takes seconds and needs no push.
The database does not: migrations are forward-only and `db push` has no undo.
A migration that has to be reversed is a new migration that reverses it, and
the nightly dump in docs/RESTORE.md is the last resort. So when a deploy pairs
a migration with code, roll the code back first and leave the schema. That is
safe as long as the migration only added, which every migration so far has
done to data: the only drops to date replace a view, a function and three
check constraints with wider ones.

---

## 8. Verify, in this order

1. **Log in.** Visit the production URL. You should get the login screen, and
   an email with a six digit code should arrive at `OWNER_EMAIL`. Type the
   code into the screen you already have open; that is the path that works on
   a phone. If the email has a link but no code, the Magic Link template is
   missing `{{ .Token }}`. If the link in the same email
   404s, Site URL in step 5 is wrong.
2. **Connect the providers.** Settings > Connections, paste the Anthropic,
   Voyage and Resend keys. Each card runs Test on save; all three should go
   green. These are new rows encrypted with the new production key.
3. **Run the nightly by hand.** Press **Run now** on the dashboard. Then check
   Agent Log: you should see one run with every job listed and none failed.
4. **Check the email.** One digest to `OWNER_EMAIL`.
5. **Install the PWA.** Open the URL on your phone, Share > Add to Home Screen.
   Then Settings > Notifications > Devices and enable push.

If step 3 shows a failed job, Agent Log names it and keeps its error. That is
the fastest place to look, not the Vercel logs.

---

## Rotating a secret

Each secret below is set in a specific place and rotating it breaks a specific thing
until every place holding it is updated. Nothing rotates on its own.

| Secret | Set in | Rotating it breaks |
|---|---|---|
| `ENCRYPTION_KEY` | Vercel and local `.env` | Every row in `core.connections`, which is encrypted with it. Re-enter every provider key in Settings > Connections after the deploy. The rows cannot be re-encrypted because the old key is gone. |
| `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` | Vercel and `.env`, generated with `node -e "console.log(require('web-push').generateVAPIDKeys())"` | Every push subscription. Each device re-enables notifications in Settings. |
| `CRON_SECRET` | Vercel (and vercel.json's cron sends it automatically) | Nothing. The next nightly uses the new one. |
| `MCP_TOKEN` | Vercel and `.env` | Nothing in the app. Re-run `claude mcp add` with the new bearer on each machine. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard (Project Settings > API keys), then Vercel and `.env` | Nothing once Vercel has the new value; storage uploads and setup fail until it does. |
| Database password (inside `DATABASE_URL` and the `BACKUP_DATABASE_URL` GitHub secret) | Supabase dashboard (Project Settings > Database), then Vercel, `.env` and the GitHub secret | Every connection until all three are updated; the backup goes red until the GitHub secret is. |
| `STRAVA_CLIENT_SECRET` | Strava API settings, then Vercel and `.env` | Nothing until the next token refresh, which fails until Vercel has it. |
| `GOOGLE_CLIENT_SECRET` (and `GOOGLE_CLIENT_ID` if the client is recreated) | Google Cloud console > Credentials > the OAuth client > Add secret, then Vercel and `.env`, then delete the old secret | The hourly token refresh fails until Vercel has the new secret, so the Calendar pull goes red. A new client id also needs a Reconnect on Settings > Connections. |
| `BACKUP_REPO_TOKEN`, `SUPABASE_ACCESS_TOKEN` | GitHub repo secrets (a GitHub PAT with contents write on pos-backups; a Supabase scoped personal access token at supabase.com/dashboard/account/tokens: the POS project only, API Keys read, API Key Secrets read, Storage read, created 2026-10-12 with a one year expiry). Set from the GitHub website (Settings > Secrets and variables > Actions) or `pbpaste \| gh secret set`, checking the clipboard starts with `sbp_` first | The nightly backup, until updated. An expired Supabase token costs only the storage mirror: the dump still lands, the run goes red and POS raises an alert. |

Provider keys (Anthropic, Resend, SimpleFIN, Health Auto Export's shared secret) are
not environment variables. They live encrypted in `core.connections` and rotate in
Settings > Connections with no deploy.

## What is not covered here

- **A custom domain.** Optional. Vercel's generated URL works, and changing the
  domain later means updating Site URL again.
- **Backups.** The GitHub Action in `.github/workflows` handles this and is
  already drilled. See docs/RESTORE.md. The same workflow is the cron-silence
  check: its last step fails when no nightly finished in the last 36 hours,
  and GitHub emails you about a failed scheduled run.
- **Tailscale.** The original plan preferred a private network. You chose a
  public URL with auth in front, so the protection is `OWNER_EMAIL` plus
  disabled signup plus the two settings in step 5.
