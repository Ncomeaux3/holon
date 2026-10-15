# POS Spec

Full module specification. Loaded on demand via the /module skill or @docs/SPEC.md. Not loaded every session.

**Since 2026-09-07 the design bundle is the screen spec.** Each module is built to its prototype in the Omelette handoff; the build plan is kept in the private working repo. Where this file and a prototype disagree about what a screen shows, the prototype wins.

**The prototype governs layout and copy. Since 2026-10-08 styling comes from holon-ui** (`@ncomeaux3/holon-ui`, the private package in `Ncomeaux3/holon-ui`, with its notes in `docs/design/APPLE-HIG.md`): Holon moved toward the Apple HIG. That means the iOS type styles at every width (17px body, `text-body` to `text-large-title`), the label, fill, separator and grouped background tokens with `light-dark()`, opaque grouped cards on the grouped canvas, glass only on navigation, the tab bar, sheets and popovers, 26px sheets, 18px cards and 12px controls with `.concentric` for nesting, capsules for buttons and chips, 44px targets, Holon action blue as the accent, the system font first with Geist as fallback, and sentence case everywhere. `app/globals.css` imports the package and keeps only what it has no name for; the Holon alias layer (2026-09-19) was deleted at the Close, and `scripts/check-tokens.sh` fails CI when a swept path names an alias, an arbitrary `text-[` or `rounded-[`, a Tailwind named radius from `rounded-sm` up, or a hex colour outside the Skills constellation and the Travel globe. The prototype's colour, spacing and type, the earlier brand layer (2026-09-08) and the Holon contract are superseded for styling; the per-screen fidelity plans keep governing what each screen shows and how it is laid out. The Skills constellation and the Travel globe stay as features, each with its own Apple-quality rebuild track (owner, 2026-09-25).

Four things this file describes were absent from the prototypes and were held as a follow-on pass until each module's screen shipped. All four are now built: the Travel cents-per-point calculator (`modules/travel/globe.ts`), Meals cook mode (`modules/meals/scale.ts`), Fitness workout plans with coach proposals (`modules/fitness/coach.ts`), and the Ideas research rubric with citations and depth (`modules/ideas/rubric.ts`).

Single-user, self-built personal operating system. Replaces a Notion setup. Modular by design: each module owns its data, its ingestion, and its tools. One orchestrator agent reads module digests and compiles a dashboard.

Owner: Nick. Solo builder, nights and weekends. Ships incrementally. Do not build every module to 20%. Finish one before starting the next.

## Core architecture principles

1. **One database, one schema per module.** Postgres. Each module gets its own schema (`finance`, `skills`, `tasks`, etc). No cross-schema foreign keys except to the shared `core` schema.
2. **Digest pattern.** Every module has a `digest` table written nightly by its own job: key numbers, upcoming items, alerts. The orchestrator reads digests only. It touches raw data only when the user asks a direct question.
3. **Every module exposes tools.** Minimum: `get_digest`, `query`, `write`. Tools are the only way agents touch a module. One MCP server at `/api/mcp` with namespaced tools (`finance.get_digest`); `query` and `search` are provided by core. Guarded tools (money, policy, goals) land in `core.proposals` when an agent calls them. See docs/ARCHITECTURE.md.
4. **Rules first, model second.** Classification (transactions, skills, tasks) runs deterministic rules first. The model only handles what rules cannot. Every model decision stores `confidence` and `classified_by`.
5. **Manual override always wins.** Any auto-classified field has a paired `is_manual` flag. Jobs never overwrite a row where `is_manual = true`.
6. **Secrets never in the repo.** `.env` only, gitignored. Policy numbers and account identifiers encrypted at rest.
7. **Single user.** No signup flow. One auth method. Prefer a private network (Tailscale) over a public URL if self-hosted.
8. **Replace Notion one module at a time.** Amended 2026-09-09: no importers are built, by the owner's decision. Notion stays the archive and POS starts empty except for what is entered. Every table still carries `source` and `external_id` with a `unique (source, external_id)`, so `source = 'notion_import'` stays a legal value and an importer can be added per module later without a migration.

## Shared `core` schema

- `core.entities` (id, module, entity_type, entity_id, title, created_at): registry so any row in any module can be linked.
- `core.skill_links` (entity_ref, skill_id, weight, confidence, classified_by, is_manual): links anything to a skill. This is the backbone of the Skill Tree module.
- `core.events` (id, module, entity_ref, event_type, payload, occurred_at): append-only log. Skill XP, goal progress, and digests are computed from events.
- `core.notifications` (id, channel, title, body, due_at, sent_at).
- `core.jobs` (id, module, name, schedule, last_run, last_status, log).

## Modules

### 1. Finance (includes Subscriptions)
- Bank aggregation: provider TBD (Plaid, SimpleFIN, or Teller). Abstract behind a `BankProvider` interface so it can be swapped.
- Tables: `accounts`, `balances_daily`, `transactions`, `categories`, `category_rules`, `budgets`, `budget_lines`, `recurring` (detected bills), `subscriptions`.
- Amended 2026-09-12. `budgets` and `budget_lines` are one table, `finance.budget`, one row per category per month with `unique (category_id, month)`. A budget header with no fields of its own was a join for nothing.
- Recurring detection: same merchant, amount within 10 percent, regular cadence (weekly, monthly, yearly). Output feeds `subscriptions` and bill-due notifications.
- Subscriptions: name, vendor, amount, cadence, next_charge, category, linked transaction pattern, status (active, paused, cancelled), cancel_url, notes. Subscriptions with no matching charge in 2 cycles get flagged.
- Digest: net worth and 30 day change, upcoming charges next 14 days, budget categories over 80 percent, unusual transactions.
- Net worth snapshot nightly per account.

### 2. Ideas / Projects
- Submit form creates an idea row and queues a research job.
- Research job runs a fixed rubric with web search: problem, market, competitors, differentiation, feasibility for a solo builder, verdict with confidence.
- Every number in the report needs a cited source or it is not written.
- Depth setting: quick or deep. Stores cost per run.
- Ideas link to skills (what skills it needs and would build).

### 3. Fitness
- Sources: Strava plus one health data source (TBD).
- Tables: `workouts`, `workout_plans`, `body_metrics` (weight, etc), `exercises`, `sets`.
- Coaching agent reads weekly digest and proposes plan adjustments. Proposals only, user approves.
- Workouts emit events that feed Health skills and fitness goals.

### 4. Meals
- Recipe import from URL via schema.org JSON-LD, fallback to `recipe-scrapers`.
- Tables: `recipes`, `ingredients`, `steps`, `meal_log`.
- Amended 2026-09-12. `meal_log` is `meals.plan_entry` with an `eaten` flag: a planned meal and an eaten one are the same row at two moments, and the flag is the whole difference. Logging something with no recipe is a `plan_entry` with a label and a null `recipe_id`.
- Cook mode view: large text, step at a time, ingredient scaling.

### 5. Travel
- Tables: `trips`, `itinerary_items`, `places_visited` (lat, lng, dates), `loyalty_programs` (manual balances, no public APIs exist), `bookings`.
- Amended 2026-09-12. `bookings` is folded into `travel.itinerary_item`: an item carries `amount_cents`, `confirmation` and `status` (`pending` from a parsed email, `confirmed` by the owner), and only confirmed spend counts against the trip budget. A booking was an itinerary item with a receipt.
- Map view of `places_visited`.
- Booking helper: cents per point calculator with user-supplied cash and points prices. Do not attempt to scrape loyalty sites.

### 6. Second Brain (schema and module id `brain`)
- Obsidian vault in git is the source of truth. The app never edits the vault without a review step.
- Ingestion: URL to readability text, YouTube to transcript, book notes manual. Model drafts a summary note, user approves, note is committed to vault.
- Amended 2026-09-09. **yt-dlp is not used and cannot be**: it is a Python binary and the Vercel Node runtime cannot run one. Transcripts come from the caption track list on the watch page, which is what yt-dlp reads for captions anyway. A video with no captions says so rather than producing a note about a video nobody watched.
- Amended 2026-09-09. Readability extraction is hand rolled with no parser dependency, because the extracted text is shown beside the draft and a bad extraction is therefore visible and correctable rather than silent.
- Amended 2026-09-09. `ingest` is guarded, alone in this module, because it is the only tool here that spends money. The summary is a capped purpose alongside research: reaching the cap leaves the draft and the source text intact and drops only the summary.
- Not built: committing an accepted note back to the vault. The vault client is read only by construction and there is no write path to propose through yet.
- Amended 2026-09-14. POS is the primary store and the vault a pulled archive. One capture box above the list takes text (first line is the title), a bare URL (ingested as today) and a "worked on" entry (kind `daily`). Hubs (`brain.hub`, `brain.note_hub`) are owner-named keyword groupings, filed by rules at capture and by one batched Haiku call nightly for misses; a manual tick wins. Related notes by embedding show while typing and on each note, the one resurfacing mechanism. Not built by decision: per-note summaries, hub summaries, weekly email, vault write back, XP for daily entries, graph view.
- Embeddings into pgvector on note change. Semantic search tool.
- Every note is classified to skills. Finishing a book or article emits a skill event.

### 7. Skill Tree (character sheet)
- Amended 2026-09-15. The full spec is docs/SKILLS.md (the owner's rewrite: nine attributes, about 180 leaves, XP attribution frozen per event in `core.event_skill_links`, confidence removed from the XP formula, one XP budget per event split across its skills, projects, challenges and achievements as evidence, a review queue for unclassified rows). Its build plan is kept in the private working repo. Where the bullets below and docs/SKILLS.md disagree, docs/SKILLS.md wins.
- Tree of attributes, categories, and leaf skills. Example:
  - Engineering: Coding (TypeScript, Python, SQL), Systems (Architecture, Cloud, DevOps), AI (Agents, RAG, Evals)
  - Business: Product, Sales, Finance literacy, Marketing
  - Communication: Writing, Speaking, Negotiation
  - Health: Strength, Endurance, Nutrition, Sleep
  - Life ops: Personal finance, Travel, Cooking
  - Amended 2026-09-08. Skill Tree is a module with its own `skills` schema, not part of core: it owns `skills.xp_weight`, `skills.override`, `skills.level()` and the `skills.xp` view. Only `core.entities`, `core.events` and `core.skill_links` stay in core. `register()` classifies through an optional `classifier` on the module manifest, so deleting `modules/skills/` leaves a working app.
  - `modules/skills/skills.yaml` is the committed tree and stays generic: this repo holds nothing personal. The owner's own tree is rows in `skills.override`, edited in the UI, because the Vercel filesystem is read only at runtime. Reset to the default is a delete of every row. Nodes have id, parent, name, description, keywords.
- XP model: every event in `core.events` that links to a skill contributes XP. Weights per event type live in config (task completed = small, project shipped = large, book finished = medium, workout = small to Health). Level is a function of XP. Keep the formula simple and visible. Do not invent precision.
- Parent attribute score = weighted sum of children.
- Auto-classification: when any entity is created (task, note, idea, goal, workout, recipe), a `classify_to_skills(entity)` service runs rules (keyword match from `skills.yaml`) then the model for anything unmatched, writing `core.skill_links` with confidence. Manual edits set `is_manual = true`.
- Views: graph view (force-directed, Obsidian style, nodes sized by level, edges parent to child, click to drill), radar chart of top-level attributes, per-skill timeline of XP and the events behind it.
- Skills digest: skills gaining fastest, skills stagnant 60+ days, skills with high goal weight but low activity.

### 8. Insurance and Policies
- One table: `policies` (type, carrier, policy_number encrypted, coverage_summary text, premium, cadence, expiration_date, status, document_url, notes).
- Types: auto, renters or homeowners, life, health, device (AppleCare, device care), other.
- Amended 2026-09-07. Discrete `deductible`, `coverage_limits`, `agent_contact` and a documents collection are stored, because they are facts copied off a declarations page. `coverage_summary` stays as free text alongside them. The rule that survives is the one that mattered: nothing analyses these fields. No gap analysis, no adequacy scoring, no model judgment of whether the coverage is enough.
- Views: list of policies with type, carrier, coverage summary, policy number (masked, click to reveal), expiration date. Sort by expiration.
- Notifications 30 and 7 days before expiration.
- Optional link to a `finance.recurring` row so the premium shows in Finance.
- Digest: policies expiring in the next 60 days.

### 9. Goals
- Tables: `goals` (title, description, target_value, unit, metric_source, deadline, status), `goal_checkins`.
- `metric_source` points at a module query (example: `fitness.body_metrics.weight latest`, `second_brain.books.finished count`). Progress is computed, not typed, when a source exists. Manual check-ins otherwise.
- Goals link to skills and to tasks. Goal digest: on track, at risk, stalled.

### 10. Tasks
- Tables: `tasks` (title, notes, due, priority, status, project, goal_id, source, estimated_minutes, completed_at), `projects`.
- `source` is `manual` or `agent`. Agent-created tasks start in a review state.
- Completing a task emits an event. Skill links computed at creation, editable.
- Views: today, this week, by goal, by project.

### 11. Orchestrator
- Runs on schedule (default daily 6am) and on demand.
- Reads every module's `get_digest`. Writes `core.dashboard_summary`. Sends one notification.
- Can propose tasks and goal adjustments. Proposals go to the task review state, never directly to active.
- Ad hoc questions go through Claude Code or the Claude app connected to `/api/mcp`. No in-app chat.

## Cross-module linking summary

Everything created anywhere gets: an entry in `core.entities`, skill links via `classify_to_skills`, and an event in `core.events`. That is what lets Skill Tree, Goals, and the dashboard stay consistent without each module knowing about the others.

## Build order

1. `core` schema, auth, dashboard shell, job runner, notifications, orchestrator with one stub module.
2. Skill Tree module (small, and every other module depends on `classify_to_skills`).
3. Tasks and Goals (small, exercise the linking).
4. Finance (highest daily value, hardest integration, test bank access early).
5. Second Brain.
6. Insurance.
7. Ideas.
8. Fitness, Meals, Travel.

## Conventions

- Migrations in `supabase/migrations`, one per change, prefixed with the module name, never edit a shipped migration. Migrations are the only source of schema.
- Each module lives in `modules/<name>/` with `manifest.ts`, `jobs/`, `tools/`, `ui/`, `import/notion.ts`, `seed.ts`, `README.md`. Each external provider lives in `integrations/<name>/` with `manifest.ts` and `client.ts`. See docs/ARCHITECTURE.md for both contracts.
- Tests for classification rules and recurring detection before anything else.
- Every job logs to `core.jobs`.

## v1.1 amendments (2026-09-14)

Written from the existing codebase after a week of live use, by /adopt-repo. The build plan and the decisions behind each line are kept in the private working repo. Where this section and an earlier section disagree, this one wins.

- **Tasks (section 10).** `tasks.project` gains `goal_ref` referencing `core.entities`, optional, as `task.goal_ref` already is. A task in a project linked to a goal counts toward that goal; a task's own `goal_ref` wins when set. Both are one SQL expression (`coalesce(task.goal_ref, project.goal_ref)`) that the board and the `linked` seam read. Projects are created, renamed, linked and archived in a Projects drawer through a new `write_project` tool; `write` keeps taking `project` by name. Due date accepts any date through a native date input beside the presets. Every task view carries a plus that opens the task form prefilled with what the view implies (goal, project or due).
- **Skill Tree (section 7).** Two new tools, `skills.link` and `skills.unlink`, write and remove a `core.skill_links` row with `is_manual = true`, `classified_by = 'human'`, `confidence = 1`. Every entity drawer renders one shared `SkillPicker` (auto chips with their badge, an x per chip, a plus with a native select). Automatic classification is unchanged and never overwrites a manual row. One reader, `core/skill-links.ts`, replaces the per-module copies.
- **Travel (section 5).** `travel.destination` (trip_id, name, lat, lon, starts_on, ends_on, position) holds a trip's places; the trip's own `destination`, `lat`, `lon`, `starts_on` and `ends_on` become the summary (first destination, min and max dates) so every existing reader keeps working. The globe pins every destination with coordinates; a completed trip writes one `place_visited` per destination. A guarded `merge_trip` folds one trip into another as a destination and re-points its itinerary, packing, budget lines and places.
- **Orchestrator and dashboard (section 11).** A `dashboard_layout` setting (`{ order, hidden }`) in `core.settings` replaces the per-device localStorage order; one layout for phone and desktop. `callTool` recomputes the calling module's digest after every write tool, so dashboard tiles read the latest `core.digests` rows rather than the nightly `core.dashboard_summary`; the headline and Last run line stay nightly. `core.digests` is pruned to one row per module per day past two days. `core.notifications` gains `href` so a warning drills into its source. The nightly digest email goes out every night, "Nothing needs you today" when there are no alerts. The System tile becomes a corner line linking to the Agent Log. The phase-1 `notes` stub module is removed; Second Brain is the notes module.
- **Finance (section 1).** The 30-day net worth series is a 30-day date spine (missing days null, gaps after the first point carried forward), the chart's y axis is padded and a flat series draws mid-height, the average is shown, and the 30-day change compares against the first known point.
- **Fitness (section 3).** Workouts and metrics come from Apple Health through Health Auto Export Premium's webhook (the free Shortcut route sends readings only, and Strava API apps now need a paid Strava subscription). The screen gains a Trends tab (per-metric line charts over 30, 90 and 365 days), workout history filters, a plan create and edit form over `write_plan`, and a Sync band that also shows when Apple data last arrived.
- **Platform.** Speed work removes request waterfalls and refetches with React `cache()`, `Promise.all` and native `history.replaceState` for view switches; no TTL caches. Hardening adds `error.tsx`, a `pnpm audit` CI step, branch protection, `maxDuration` on the API routes, storage buckets in the backup, and a secret rotation note.

## v1.2 amendments (2026-09-20)

Written after the Holon release from a first day of use, by an interview on 2026-09-20. The build plan and the interview notes are kept in the private working repo. Where this section and an earlier one disagree, this one wins.

- **Calendar, a new module.** Schema `calendar`, one table `calendar.event` for external feeds and typed events (`unique (source, external_id)`). Every module exposes its dated rows through a `calendar` seam on its manifest, the way `review`, `metrics` and `linked` work: core reads no module schema. The screen is a month grid with a day list under it; Tasks keeps its own Calendar view. External feeds are read only in this version: Google Calendar by OAuth, iCloud calendars by public `.ics` URL, Apple Reminders by a Shortcut posting to a webhook, Gmail into proposals. Writing back to any of them waits for the v2 verb executor. Amended 2026-09-23 (phase 6a): Fitness sends logged workouts, since plan items are not dated by design; a module is marked by its nav icon and label, not a colour; recurring charges and Home services are projected forward on read and drawn muted; a trip is an all-day item on each of its days; the phone shows a week strip, the desktop the month grid shared with Tasks; the modules switched off are kept in `calendar.settings`; typed events are added and edited in a drawer and are not registered in `core.entities`.
- **Tasks (section 10).** `tasks.task.repeat` holds a rule (daily, weekly on days, monthly on a date or the last day, yearly, with an interval). Completing a repeating task writes the next instance with the next due date; one open instance at a time. Reminders from Apple arrive as tasks with `source = 'apple_reminders'` and never overwrite a manual field. Gmail proposals become review-state tasks on approval, as agent tasks always have. Amended 2026-09-23 (phase 6b): the next instance is due on the first date past both the old due date and today; a unique `repeat_from` makes one open instance hold in the database; dropping a repeating task in the weekly review writes its next instance too; later dates are projected on both calendars and never written.
- **Finance (section 1).** `finance.category.kind` is one of `expense`, `income`, `transfer`, `credit`. Credit card payments and account transfers are `transfer` and never count as spending; refunds and statement credits are `credit` and net against the category they refund. Budget spent is `expense` minus `credit` in the category, pending rows excluded unless `finance.count_pending` is on. A manual category offers to become a `category_rule` for that merchant. `finance.transaction.trip_ref` links a transaction to a trip through `core.entities`; Travel reads spend through a Finance seam, never the finance schema. A non-monthly recurring shows its monthly equivalent as "set aside" in its budget row. Amended 2026-09-22 (phase 5c): money to or from an individual is a `People` expense category, not a transfer, and the `zelle`, `venmo` and `cash app` patterns outrank the transfer ones; `finance.category_rule` carries `classified_by` and `confidence`; rules are listed, edited and deleted in a Rules drawer through `write_rule` and `delete_rule`, and writing, editing or deleting one re-files every matching row where `is_manual = false`; the Transactions tab filters All, Uncategorised and Pending with the ledger's own counts. Amended 2026-09-22 (finance-charts phase 1): `finance.account.in_cash_flow` decides which accounts the cash flow card and the dashboard's net-this-month count, set per account in a drawer on the Finance page through `set_cash_flow_accounts`; brokerage, retirement, crypto and `other` start off; budgets, the category trend and net worth read every account. An `Entertainment` expense category joins the defaults.
- **Travel (section 5).** Itinerary items carry a kind, an optional time and a status; a reservation is a confirmed item. The day's place is the destination whose dates cover it. Budget, Planned (confirmed items) and Spent (linked transactions) are three numbers. `travel.loyalty_program.account_ref` links a program to the Finance account that earns it; balances stay manual and nothing scrapes a loyalty site. Amended 2026-10-13 (phase 10a): kinds are flight, lodging, transit, activity, food and other, and status is idea, pending or confirmed; an item's `place` text overrides the day's city; a reservation carries a provider and an optional file in the `travel` bucket; an emailed event inside a trip's dates is a pending item in that trip's Inbox rather than a Review proposal; the loyalty account link is built in 10b. Amended 2026-10-14 (phase 10b): Spent is the transactions tagged to the trip, read through a Finance `spend` seam; Remaining is the budget less the larger of Planned and Spent; the tag carries its own `trip_classified_by` (`rule` or `manual`) apart from the category's `is_manual`; the pre-tag rule matches a destination's city as a whole word in the descriptor on that destination's days, with no confidence stored; Finance registers its accounts (no event, no skill classification) so a loyalty program names its card, and the card's spend shown is the last full calendar month, SimpleFIN sending no statement dates.
- **Insurance (section 8).** `post_to_finance` calls `finance.write_recurring` through `callTool` with the policy's cadence and next charge; turning it off removes the row. Amended 2026-10-14 (phase 11): a policy posts only while it is active, its expiry date is today or later and its premium is above 0; lapsed, cancelled, expired unrenewed, deleted or switched off removes the row. The row is `source = 'insurance'`, filed under `Insurance premiums`, and Finance shows its monthly equivalent as "set aside" on that budget row; quarterly and semiannual are cadences Finance now accepts. Finance moves the next charge date on nightly, so Insurance posts on write and renew, and its nightly job only removes the premium of a policy whose expiry has passed.
- **Health.** The Insurance card reads the digest's per-type breakdown and shows health-type policies only.
- **Fitness (section 3).** Apple Health is the source. Strava stays an optional provider in Settings; the band and the empty state stop naming it first. Exercises, plans and fitness goals have forms.
- **Meals (section 4).** A recipe can be typed, imported from a URL, or pasted as text: rules first, then one Haiku call to a draft under the cap. Ingredient macros come from USDA FoodData Central (key in `core.connections`). Failed imports store their reason. Instagram is paste only. Amended 2026-10-14 (phase 12): a failed import's reason (no JSON-LD, blocked, timeout, parse error) is shown under the URL box with Paste it instead and logged to the Errors tab through `core.request_log`, with no `meals.import_attempt` table (owner); a USDA match stores `fdc_id`, `grams` and the macros for those grams on the ingredient, searching Foundation and SR Legacy foods only, and the recipe's per-serving columns follow the matched sum until typed over; a pasted recipe calls the model only when the rules miss ingredients or steps, under a capped `recipe` purpose, and carries `classified_by` and `confidence`; the recipe photo moved to Phase 15 (owner).
- **Skill Tree (section 7).** A skill's event list links to the entity that earned it through a manifest `entityHref`; a deleted entity keeps its title and says so. Amended 2026-10-12 (phase 13): a module with no drawer for the type opens its page; a deleted entity's events leave the list, because every delete path removes its `core.entities` row and its skill links cascade, so no "(deleted)" label is drawn (revisit with skills-v2's frozen `core.event_skill_links`).
- **Weekly review.** Settings for week start (Sunday or Monday), review day and time, a reminder and an optional recurring task. One `startOfWeek` in `core/clock.ts` is the week for every module. Amended 2026-10-14 (phase 14): the default week starts Monday and the review is Sunday 18:00; Tasks This week runs to the week's last day; the reminder is an in-app alert at the review time under the `system/weekly_review` rule, queued nightly and on save and skipped for a closed week, since the one daily cron sends email and push only on its next run; the recurring task is written through the guarded `tasks.review_task` tool and completed when the review closes; goal metrics such as `*_this_week` stay a rolling seven days; the Calendar month grid stays Sunday-first until holon-ui's `MonthGrid` takes a week start.
- **Platform.** An Errors tab on the Agent log (request log failures, failed job runs, client errors captured from `error.tsx` into `core.client_errors`) and a diagnostics card in Settings; no external error tracker. Every form names a missing or invalid field at the field and submits on Enter. Every clickable element has a visible fill or border, a hover state and a pointer; ink tokens meet 4.5:1 at 11px in both themes. Amended 2026-09-20 (phases 3b and 3c): the phone tab bar is a floating glass capsule inset from the edges, holding Home, Tasks, Finance, Calendar and Browse, shrinking to a pill on scroll down and scrubbed between tabs by a swipe on the capsule; an initials avatar on the tab roots (and on desktop band one) opens Settings, Notifications, Agent log, theme and Sign out, and those links leave Browse and the rail footer; the font stack is the system font first, Geist as fallback; phone pages push, pop and cross-fade through React `ViewTransition` while desktop keeps the reveal stagger; one shared `SwipeRow` gives Review, Notifications and Tasks rows two swipe actions. Versioning is semver: `package.json` is the source, shown in Settings and the Agent log; a completed plan bumps minor and is tagged with a GitHub Release; a fix on a shipped version bumps patch.

