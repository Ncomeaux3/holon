# Connections registry

Every external system the POS or Claude Code can reach. Update when a connection is added or removed. Each provider row becomes an `integrations/<name>/` folder with a manifest; credentials are entered on Settings > Connections and stored encrypted in `core.connections`, never in `.env`.

See docs/SETUP-INTEGRATIONS.md for what each one needs.

| System | Purpose | How connected | Status |
|---|---|---|---|
| Supabase | Postgres, pgvector, storage, auth | MCP + supabase-js + CLI | local stack via the CLI; a hosted project for production |
| Vercel | hosting, cron, firewall | MCP + Git integration | hosts a deployed instance |
| GitHub | repo, CI, backups repo | gh CLI + Actions | the app repo plus an optional private backups repo |
| Anthropic API | classification, headlines, research | integrations/anthropic (token) | built. Paste a key on Connections |
| Voyage AI | embeddings | integrations/voyage (token) | built. 3 requests a minute until a card is on file |
| Resend | daily digest email | integrations/resend (token) | built. Sends from `onboarding@resend.dev` to the `digest_email` setting until a domain is verified |
| SimpleFIN Bridge | bank and card transactions | integrations/simplefin (token) | client, real Test and nightly `finance.sync_simplefin` built. Paste a setup token and it is claimed on save. Needs a bridge subscription |
| Strava | workouts | integrations/strava (oauth2) | client and nightly `fitness.sync_strava` job built, Test is real. Needs an app registration for the client id and secret |
| Health Auto Export | Apple Health metrics | integrations/health_auto_export (webhook) | manifest defined, used by Fitness |
| Obsidian vault repo | second brain source of truth | integrations/github_vault (token) | read only client and a real Test built. Needs a private repo and a fine grained token |
| Notion | per-module export for import scripts | export files only | optional, for a one-time import |
| Google Calendar | not planned; email covers the digest | none | dropped |
