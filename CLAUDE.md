# Holon (Personal Operating System)

Single-user personal operating system: a database-backed app with modules (Finance, Skill Tree, Tasks, Goals, Insurance, Second Brain, Ideas, Fitness, Meals, Travel) plus an orchestrator agent that reads module digests. This repo is also the Claude Code workspace that builds and operates it, and it is a fork-and-fill template: the code holds nothing personal.

Owner: Nick. Solo, nights and weekends. Finish one module before starting the next.

## Read on demand, not every session
- How it is built: docs/ARCHITECTURE.md (read before touching core, a manifest, or a migration)
- Full module spec: @docs/SPEC.md (use /module <name> to load one module's section)
- Skill Tree full spec: docs/SKILLS.md (the 2026-09-15 rewrite)
- The next version: docs/SPEC-v2.md (the agent layer, specified 2026-09-14, not started)
- Build status, plans, open choices and the decision log are kept in the private working repo, not in this one. A fork keeps its own in docs/plans/, docs/DECISIONS.md and decisions/log.md.
- Legal promises and what keeps them true: docs/LEGAL.md (read before adding a provider, analytics, a cookie, email, payments or signup, and update /privacy or /terms first when one changes what they say)

## Rules that must hold
- Ask before assuming. If an assumption changes what gets built, stop and ask with AskUserQuestion.
- Rules first, model second. Deterministic classification runs before any model call. Every model decision stores confidence and classified_by.
- Manual override wins. Never overwrite a row where is_manual = true.
- One Postgres schema per module. Cross-module links only through the core schema.
- A module or integration is one folder with one manifest. Nothing in core is edited to add one.
- Every module ships a nightly digest and exposes get_digest and write tools. Core provides query and search. The orchestrator reads digests only.
- Account credentials come from core.connections via getCredentials(). .env holds infrastructure secrets only.
- Simplest approach that works. No helper abstractions, no premature refactors.
- Never invent facts, prices, or API capabilities. Mark unverified claims "verify".
- No em dashes anywhere (code comments, docs, UI copy).
- A read that calls an outside service from the browser is a GET route, not a server action: actions run one at a time, and a slow call blocks every save behind it.

## Workflow
- Plan mode for anything touching more than one file or a migration. Write the plan to docs/plans/<name>.md, get approval, then a fresh session implements it.
- Write the test before the feature for classification rules, recurring detection, and XP calculation.
- Show evidence of verification (test output, command result), not a claim that it works.
- An e2e test that toggles a persisted setting waits for the action's POST and asserts the restored state after a reload; an optimistic button flip is not proof the write landed.
- Commit after each completed step with a descriptive message. Log any decision to decisions/log.md.
- When compacting, preserve the list of modified files, open questions, and the test command.
- A red CI check is a merge gate: never merge a PR while any check is red, and say so if asked to. Branch protection on main requires `check`, `screens` and `migrations` green and binds admins too (set 2026-09-15 in v1.1 phase 12), so GitHub refuses the merge as well.
- A PR is green only when `gh pr view <n> --json mergeStateStatus` reads CLEAN; CI posts `screens` from both the push and the pull_request run, and one can pass while the other is still running.
- A PR that adds a migration goes red until its description carries a line reading `db push: done`, or `db push: not needed` when the schema should not move yet. Merging deploys the code; `supabase db push` is manual and does not follow. Twice now the code has arrived in production ahead of its schema and the nightly came back partial naming a table that did not exist.

## Tools for this project
- Agents: `quick-builder` for Complexity low phases and small specified edits; `test-runner` for the full suites, lint, typecheck and build; `ui-verifier` after any change to a screen, at 402 and 1440 px, against the artboard in the design bundle; `spec-reviewer` before each PR; `prod-auditor` on the last phase of a plan; `researcher` and `reviewer` (in `.claude/agents/`) for docs lookups and a fresh-context diff review.
- Skills: `/module <name>` to load one module's spec; `/integration` before touching a provider; `/research` before adding a dependency; `code-review` before a PR; `brainstorming` before a new screen or a schema change; `design-taste-frontend` (v2) before any screen or component work, applied inside the Holon contract (its tokens, radii, type and the kept constellation and globe win where they conflict). The skill calls dashboards out of scope, so only its app-relevant checks bind: dashes, contrast, focus, motion and reduced motion, both themes, pointer handling, copy, and empty, loading and error states.
- MCP: the Vercel connector for deployments, build logs and runtime errors of project `pos` (production `pos-gilt-rho.vercel.app`); the Supabase connector for the hosted project; context7 for Next 16, Supabase and Playwright docs; the Playwright plugin for `ui-verifier`; `pos` (`http://localhost:3000/api/mcp`, bearer `MCP_TOKEN`) is the app's own server and only answers while `pnpm dev` runs. Prefer `gh`, `supabase` and `vercel` CLIs when both can do the job. For v1.1 diagnosis: the Vercel connector's runtime logs and Crons tab (push, cron email, TTFB), Claude in Chrome for the push Network-tab check, context7 for the Next 16 native history API before Phase 4.

## Commands
- `pnpm dev` dev server. `pnpm test` vitest. `pnpm test:e2e` Playwright screens. `pnpm lint`. `pnpm typecheck`.
- `pnpm setup` bootstrap a fresh database and owner user. `pnpm setup:demo` also seeds synthetic rows.
- `pnpm gen:index` regenerate module and integration indexes (runs in prebuild). `pnpm gen:types` regenerate database types.
- `supabase start` local stack. `supabase migration new <name>` to create one, `supabase migration up` to apply pending ones. `supabase db push` to prod.
- **`supabase db reset` destroys local data.** It rebuilds the database from migrations, which deletes the owner user and every provider key in `core.connections`. Those keys cannot be recovered: they are encrypted and exist nowhere else. Use `supabase migration up` to apply a new migration to a live local database. Reset only when the schema genuinely needs rebuilding, and say so first.

## Next.js 16
This is Next 16 with Turbopack and Tailwind v4. Conventions differ from older Next: there is no `tailwind.config.ts` (CSS-first config in `app/globals.css`), and `pnpm typecheck` runs `next typegen` first because route types like `LayoutProps` are generated. Read `node_modules/next/dist/docs/` before writing Next code from memory.
