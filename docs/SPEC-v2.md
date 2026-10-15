# SPEC v2: the agent layer

Status: specified, not started. Supersedes the draft SPEC-v2 of 2026-09-14.
Re-checked against main on 2026-09-15, after the first four v1.1 phases merged.
Load on demand. Do not load into every session.

v2 gives the agent hands. It connects to external accounts, proposes work
against them, and executes what the owner approves, writing the result back
into the POS the same way a module write lands today.

The draft this replaces was written as though v1 were a bare core with an
orchestrator stub. It is not. Twelve modules ship, the nightly run is 30
jobs, and six of the draft's subsystems are already half built under other
names. Everything below is written against what exists.

## 1. What already exists

Read this table before proposing a new table.

| The draft wanted | What is built | Where |
|---|---|---|
| Credential vault, one record per connector, rotatable | `core.connections`, AES-256-GCM, `getCredentials()` the only reader | `core/credentials.ts`, `core/crypto.ts` |
| Connector manifest, plugin discovery | `integrations/<id>/manifest.ts`, generated index, generic OAuth and webhook routes | `core/integration-contract.ts` |
| Approval gate | `shouldGuard()`, `core.proposals`, the Review screen | `core/tools.ts`, `core/proposals.ts` |
| Audit trail with undo | `core.write_log` with before values and revert payloads, the Agent Log | `core/writelog.ts` |
| Runs | `core.job_runs` | `core/jobs.ts` |
| Push channel | Web push plus Resend email, gated by `core.notification_rules` | `core/push.ts`, `core/notify.ts` |
| Per-run cost | `core.llm_calls`, month to date, soft cap | `core/llm.ts` |
| Templateability | `pnpm setup`, `pnpm setup:demo`, the Onboarding wizard, `config/connectors.yaml` | `scripts/setup.ts` |

Two things the draft named are genuinely new: the memory tier, and the
per-verb permission model. Everything else is an extension.

## 2. Vocabulary

**Integration**, not connector. `config/connectors.yaml` already means
something else: the catalogue of providers Onboarding offers. v2 never uses the
word connector for a live account. An integration is one folder with one
manifest, as it has been since 2026-09-05.

**Verb.** One named operation an integration exposes: `list_messages`,
`send_message`. Declared on the manifest. A verb is to an integration what a
tool is to a module.

**Action.** One intent to call one verb, held in `core.proposals` from the
moment it is proposed to the moment it succeeds or fails.

## 3. Prerequisites

All met as of 2026-09-14. Recorded so a later reader can check the ground has
not moved:

- `core.events` append only, emitting from twelve modules
- `core.entities` registering every module row through `register()`
- Classification rules-first: `classify()` runs keyword rules in the write
  path, the model runs in a nightly batch
- The orchestrator assembles a real dashboard from per-module digests
- `core.write_log` carries revert payloads and undo works

The draft's prerequisite list said "`core.entities` with the `is_manual` flag
enforced". `is_manual` is on `core.skill_links` and on module rows, not on
`core.entities`. The rule it was reaching for holds: jobs never overwrite a row
where `is_manual = true`.

## 4. Subsystem 1: integration verbs and permission

### 4.1 Four levels, per integration, overridable per verb

| Level | Meaning |
|---|---|
| `none` | Registered and disabled. The default for every integration connected after v2 ships, credentials saved or not. Nothing may call it, the owner's own UI included. |
| `read` | Read verbs may run. A write verb refuses. |
| `propose` | Write verbs become actions in the ledger. Nothing executes without approval. |
| `write` | Write verbs may execute when an auto-approve rule matches. Everything else still asks. |

`propose` is the working default for anything touching the outside world.
`write` is granted per verb, never blanket.

`none` disables the integration for every caller. This is the one place where a
UI write is not automatically allowed: pressing a button in your own app is the
approval for writing to your own database, and it is not the approval for
sending mail from a disabled account.

### 4.2 The manifest gains verbs

`defineIntegration` grows three optional fields. An integration that declares
none behaves exactly as it does today.

```ts
export default defineIntegration({
  id: 'gmail',
  label: 'Gmail',
  description: 'Reads the messages you file into one label.',
  auth: { type: 'oauth2', authorizeUrl, tokenUrl, scopes: [...] },
  hosts: ['gmail.googleapis.com', 'oauth2.googleapis.com'],
  verbs: [
    { id: 'list_messages', direction: 'read',  risk: 'none', cacheTtl: 300 },
    { id: 'apply_label',   direction: 'write', risk: 'low',  reversible: true },
    { id: 'send_message',  direction: 'write', risk: 'high', reversible: false },
  ],
  rateLimit: { perMinute: 60 },
  test: async (creds) => ({ ok: true, detail: '...' }),
})
```

Risk classes: `none`, `low`, `medium`, `high`. Risk decides whether an action
can be auto-approved and how loudly the approval is delivered.

`hosts` is the egress control. See section 9.

### 4.3 Where permission is stored

```
core.connections
  + permission_level text not null default 'none'
      check (permission_level in ('none','read','propose','write'))

core.connection_verb_grants           -- new
  id, integration_id, verb_id, permission_level,
  created_at, updated_at,
  unique (integration_id, verb_id)
```

The migration backfills `permission_level = 'read'` for every row already at
status `connected`, and leaves `'none'` as the default for every other row and
every future one (2026-09-14). Three integrations are live in the nightly run
and a strict default would refuse their syncs on the next run. The guarantee
that a newly connected provider can do nothing until the owner says so is
unaffected: it applies to every row created after this migration.

No new credential store. Secrets stay in `core.connections.credentials_encrypted`,
and the agent never reads them: a verb call names the integration id, and
`getCredentials()` resolves it inside the executor. The resolved secret never
enters agent context or a log line, which is already true and is now a rule
with a test.

Revocation stays a delete of the `core.connections` row. It now also cancels
every action for that integration in state `approved` that has not executed,
and deletes the verb grants. One transaction.

### 4.4 The permission decision

Two permission systems exist after v2: `agent_autonomy` (observe, propose, act)
governing module tools, and integration level plus verb grant governing
external verbs. They compose in one function, `decide()`, in `core/permission.ts`,
and the most restrictive answer wins.

```
decide({ source, autonomy, level, verbGrant, direction, risk, tainted })
  -> 'execute' | 'propose' | 'refuse'
```

`source` is `'ui' | 'agent' | 'job'`. A job is the third because nightly syncs
are covered: see 4.5.

Rules, in order:

1. Effective level is the verb grant when one exists, otherwise the
   integration's level.
2. Effective level `none` refuses, whatever the source.
3. A write verb under `read` refuses.
4. A write verb from `source = 'agent'` at `autonomy = 'observe'` proposes.
   Read verbs are not affected: there is nothing to approve about a read, which
   is the same reason `query` is never guarded today.
5. A write verb under `propose` proposes.
6. A write verb under `write` executes only when an auto-approve rule matches
   (section 5.3), `risk` is below `high`, and `tainted` is false. Otherwise it
   proposes.
7. A read verb at `read` or above executes.

Autonomy never raises an integration above its level. `act` means the agent
does not need approval for a module write; it does not mean it may send mail.
A `job` source is not a UI source: nobody pressed a button, so a job's write
verb proposes exactly as an agent's does.

### 4.5 Every outbound verb goes through one executor, syncs included

Decided 2026-09-14. A nightly sync job does not pass through `callTool` today:
`runJob` calls the job directly and the job calls its integration client. So
without this rule the permission model would cover agent-initiated calls only,
and "revoking a credential stops everything" would be false, since a sync would
keep pulling until the connection was deleted.

`core/verbs.ts` is the one executor. An integration client calls
`runVerb(integrationId, verbId, args)`; it consults `decide()`, resolves
credentials, enforces `rateLimit` and `cacheTtl`, sends the request through
`core/fetching.ts` against the manifest's `hosts`, and records the call. A
client of an integration that declares verbs and reaches the network any other
way fails a test.

A sync at level `none` refuses, and the job records why. That is the shape the
nightly run already relies on: every unconnected sync skips and says so rather
than failing the run, and a refused one reads the same way.

**Which integrations this covers.** Three have outbound clients and declare
verbs in phase 0: SimpleFIN, the Obsidian vault (`github_vault`) and Strava.
Two are inbound webhooks, `health_auto_export` and `apple_shortcuts`: they make
no outbound call, so they declare no verbs, and their permission level gates
the webhook route instead. A push at level `none` is refused with a 403 and a
`core.request_log` row, which is what the Test button on those cards already
reads. The earlier framing of "Apple Health" as an outbound integration was
wrong and is corrected here.

Three more are infrastructure providers core uses directly and no agent calls:
`anthropic` (the SDK in `core/llm.ts`), `voyage` (`core/search.ts`) and
`resend` (`core/notify.ts`). They declare no verbs and are outside the
executor. Routing the Anthropic SDK through `core/fetching.ts` would mean
reimplementing the SDK's transport for nothing an agent can touch.

**`core/fetching.ts` grows a `request()`.** Today it exposes `get()` only.
SimpleFIN claims its setup token with a POST and sends Basic auth; Strava and
the vault send bearer headers; Gmail and Calendar will need POST and PATCH
with JSON bodies. `request(url, { method, headers, body })` carries the same
three layers `get()` has (literal rules, every DNS record checked, the
connection pinned to the checked address, redirects re-checked per hop) and
`get()` becomes a call to it.

Cost: three clients rewired, two webhook routes gated, and `request()`. That
is phase 0.

## 5. Subsystem 2: the action ledger

### 5.1 One ledger in two tables, both of which exist

`core.proposals` holds the action from proposal to outcome. `core.write_log`
holds what the execution actually did, with the values before it and the call
that would put it back. This split is what already gives the Agent Log a
working undo, which a single-table ledger does not have.

The name `core.proposals` is now wrong: the table holds approved and executed
actions too. Renaming a shipped table costs a migration plus every query in
core and in three screens, and returns a better word. It keeps its name and
this document says what it holds.

```
core.proposals  (existing columns unchanged)
  + integration_id        text          -- null for a module tool action
  + verb_id               text
  + risk                  text not null default 'none'
                                        check (risk in ('none','low','medium','high'))
  + idempotency_key       text unique   -- null allowed, unique when present
  + run_id                uuid references core.job_runs (id) on delete set null
  + plan_step_id          uuid          -- no FK: plan steps live in the goals schema
  + approved_by           text          -- 'human' or the auto-approve rule id
  + expires_at            timestamptz
  + executed_at           timestamptz
  + result                jsonb
  + error                 text
  + derived_from_external boolean not null default false
  + suggestion_class      text          -- set by the nightly pass, see 7.4

  status check widened to:
    pending | approved | rejected | dismissed | executing | succeeded | failed | expired

core.write_log
  + proposal_id uuid references core.proposals (id) on delete set null
```

`status` keeps its name too, for the same reason. `pending` is the draft's
`proposed`.

### 5.2 State machine

```
pending ──approve──> approved ──execute──> executing ──> succeeded
   │                    │                       │
   │                    │                       └──────> failed
   ├──reject──> rejected│
   ├──dismiss──> dismissed (returns after dismissed_until)
   └──timeout──> expired └──timeout──> expired
```

Rules:

- Nothing executes outside state `approved`. No bypass flag exists.
- `idempotency_key` is unique at the database level. A retry after an ambiguous
  failure cannot double send. The key is derived from integration, verb and a
  hash of the payload, so the same intent proposed twice is one row.
- Approvals expire. 24 hours by default, 1 hour at `risk = high`. An approval
  from last Tuesday must not fire an email today. Expiry is enforced at
  execution time by a predicate, not only by a sweep job, because a sweep on a
  daily cron would leave a 24 hour window where an expired approval still runs.
- A failed action never auto-retries when the verb is `reversible: false`. It
  surfaces for a decision.
- On success the executor emits to `core.events`, writes `core.write_log`, and
  stores the provider's response in `result`. Where the verb produces a module
  row (a calendar event filed into Travel, a GitHub issue filed into Tasks) the
  executor writes it by calling that module's write tool through `callTool`,
  not by calling `register()` itself. `callTool` registers the entity, writes
  the log and, since v1.1 phase 5, recomputes the module's digest, which is what
  the dashboard tiles read; calling `register()` directly would file the row and
  leave the tile showing last night's numbers until the next nightly run. The
  row carries `is_manual = false` and is never written over a row where
  `is_manual = true`. A verb with no module row, such as sending mail, writes no
  module row at all: the ledger row is its record.
- An auto-approved action writes the same full row as a human-approved one.
  The only difference is `approved_by`.

### 5.3 Auto-approve rules

```
core.auto_approve_rules                -- new
  id, integration_id, verb_id,
  max_risk text not null check (max_risk in ('none','low','medium')),
  conditions jsonb not null default '{}'::jsonb,
  daily_limit int not null,
  enabled boolean not null default true,
  created_at, updated_at
```

Constraints:

- No rule may auto-approve `risk = high`. Enforced twice: the check constraint
  above makes it unrepresentable, and `decide()` refuses it in code. The draft
  said code not config; a database constraint is the stronger half of that.
- An action with `derived_from_external = true` never auto-approves, whatever
  its risk. See section 9.
- Every rule carries a daily limit. Hitting it drops the verb to manual
  approval for the rest of the owner's day, counted through `core.today()`, and
  emits an event.
- The rule that produced an action the owner then undoes is disabled, not
  merely paused. Undo already pauses the module's notification rule for seven
  days; an auto-approve rule that produced a write the owner reversed has
  demonstrated it is wrong.

### 5.4 Audit trail

A view, not a table: `core.action_audit` over `core.proposals` left joined to
`core.write_log` and `core.job_runs`. It answers what the agent did, what it is
about to do, what it proposed that was rejected, and what failed. The Agent Log
screen reads it.

## 6. Subsystem 3: runs, budgets and the queue

### 6.1 Runs extend core.job_runs

```
core.job_runs
  + token_budget        int
  + tokens_used         int  not null default 0
  + wallclock_budget_s  int
  + elapsed_s           int
  + action_budget       int
  + actions_proposed    int  not null default 0
  + actions_executed    int  not null default 0
  + cost_cents          int  not null default 0
  + termination_reason  text
```

Cents, not dollars. Money is integer cents everywhere in this system.

The three budget columns are nullable and null means unbounded, which is what
the nightly run has had all along. Phase 3 gives the nightly run defaults from
`core.settings` and every agent run carries all three budgets. Hitting any one terminates the run
and writes `termination_reason`. Without this, one bad loop spends a month of
budget in a night. `trigger_source` already exists and grows two values:
`agent` and `plan`.

### 6.2 The queue, and what it honestly does

```
core.run_queue                          -- new
  id, kind, payload jsonb,
  state text check (state in ('queued','leased','done','failed')),
  not_before timestamptz not null default now(),
  lease_until timestamptz,
  attempts int not null default 0,
  last_error text,
  created_at, updated_at
```

Postgres backed, no Redis, no external queue. A worker leases a row with
`for update skip locked`, does one unit of work, and releases.

**The limit, stated plainly.** On Vercel Hobby there is one cron and it is
daily. A queued run advances only when something drains the queue: the nightly
cron, the Run now button, an MCP call, or a POST to `/api/agent/tick` bearing
`CRON_SECRET` or the owner's session, the same two credentials the nightly
route accepts. Nothing advances in between. A run that pauses for approval
at 10am does not resume at 10:05 because the owner approved from their phone;
it resumes on the next drain, and the approval push says so.

This is the cost of the runner decision (2026-09-14: stay on Hobby, keep the
$10 cap). It is acceptable because every v2 run is either nightly batch work or
a single approved action, and the second case can drain its own queue in the
same request that approved it. If sub-hour autonomous work ever matters, the
decision to revisit is the runner, not this design.

A run that dies mid-flight is resumable or cleanly failed. The idempotency keys
in 5.2 are what make resuming safe.

## 7. Subsystem 4: memory and proactive suggestion

### 7.1 Two tiers

**Durable facts.** Small, hand editable, versioned. Things stated once that
should hold: preferences, constraints, recurring people, standing decisions.
Under 500 rows. Past that the extraction rules are too loose and get tightened
rather than the cap raised.

```
core.facts                              -- new
  id, subject, statement,
  source_event_id uuid references core.events (id) on delete set null,
  confidence numeric, classified_by text,
  created_at, superseded_by uuid, tombstoned_at timestamptz
```

`classified_by` because every model decision in this system stores it.

**Episodic.** `core.events`, which exists. No new table.

### 7.2 Forget writes a tombstone

Forget does not delete. A deleted fact is re-extracted from its raw event on
the next pass. A tombstoned fact is excluded permanently by matching on
`source_event_id`.

### 7.3 The suggestion pass

Nightly, in the existing run, after digests and before the orchestrator.

1. Read `core.events` since the last watermark held in `core.jobs.log`, the
   same cursor mechanism every chunked job here uses.
2. Rules-first filter to candidate events. Free, and does most of the work.
3. One Haiku call over the candidates plus relevant facts, capped at five
   suggestions. `purpose: 'suggestion'`, a new capped purpose in `core/llm.ts`,
   so the soft cap stops it the way it stops research.
4. Each suggestion is an ordinary `core.proposals` row: a real module tool and
   a payload it will accept, `agent = 'suggest'`, `risk = 'none'`, status
   `pending`, and `suggestion_class` set. Approving it runs the tool through
   `approve()` exactly as any proposal is run today.

The draft had a synthetic `verb = 'suggest'` with no side effect. That would
have made `approve()` throw, since no module owns a tool by that name, and it
would have left the owner with nothing to approve. A suggestion that is worth
showing is one with a concrete next step behind it: a task to write, a goal to
check in on, a subscription to flag. The model's job is to pick the tool and
fill the payload; the rules-first filter and the payload validation decide
whether it is shown at all. One approval surface, one audit trail, no new
column beyond `suggestion_class`.

### 7.4 Dismissal is signal

`proposals.dismissed_until` already holds a dismissed row for 30 days, and
`propose()` returns the held row rather than creating a second. v2 adds the
class level counter only:

```
core.suggestion_suppression             -- new
  class_key text primary key,           -- triggering event type + suggested tool
  dismissals int not null default 0,
  suppressed_until timestamptz,
  disabled_at timestamptz
```

Three dismissals of a class disables it until the owner re-enables it in
Settings.

## 8. Subsystem 5: plans, and the surface

### 8.1 Plans belong to the Goals module

Decided 2026-09-14. Core does not own goals. `modules/goals` does, and plans
are goals work.

```
goals.plan
  id, goal_id references goals.goal, version int, generated_at,
  generated_by_run_id uuid, status, stale_since timestamptz,
  unique (goal_id, version)

goals.plan_step
  id, plan_id, sequence, kind check (kind in ('task','action')),
  title, status, depends_on uuid[],
  action_id uuid,        -- core.proposals id, no FK across schemas
  task_entity_id uuid    -- core.entities id
```

Plans are versioned, never edited in place. Re-planning writes a new version
and the old one stays queryable.

A step of kind `task` creates a task by calling `tasks.write` through
`callTool`, which Ideas already does. A step of kind `action` goes through the
ledger like everything else. Goals never touches the `tasks` schema and core
never touches either.

Re-planning is event driven. A plan registers the event types that invalidate
it; when one fires the plan is marked stale and re-planned on the next run. A
weekly re-plan of every active goal is waste.

### 8.2 No in-app chat

Decided 2026-09-14, holding SPEC section 11 and ARCHITECTURE's "not planned".
Ad hoc questions go through Claude Code or the Claude app over `/api/mcp`.

The approval surface is the two screens that already exist:

- **Review** gains external actions: the risk chip, the expiry countdown, and
  the integration and verb on the card. The card's sentence is the existing
  `title`, which the caller writes in the owner's words; the draft's
  `preview_text` was a second name for it and is not added. Approving an external
  action queues its execution and drains the queue in the same request.
- **Agent Log** gains run budgets, `termination_reason`, and the action audit
  view, so a run reads as what it spent and what it touched.

No new screen, no message table, no streaming.

### 8.3 Notifications reuse what ships

Three new rules in `core.notification_rules`:

- `action_needs_approval`, marked urgent, fired only for `risk >= medium`. A
  rule is urgent or it is not, so the risk gate is in the caller: lower risk
  actions wait in Review and appear in the morning digest, which is what the
  draft's "push is for things that block progress" meant.
- `run_failed`
- `budget_hit`

They ride web push and Resend email, both built, both already honouring quiet
hours, snooze and the global pause. Push is dark until a VAPID pair is in
`.env`. That is owner work, done by hand once per deployment.

### 8.4 Voice is out of v2

Decided 2026-09-14. Push to talk was a text entry convenience with an STT bill
and, on iOS or Chrome, audio leaving the device to a third party. It returns if
the phone becomes the primary surface.

### 8.5 Persona

Name, avatar and tone preset in `core.settings`. Half a day. Last phase.

## 9. Security posture

Single user, cloud hosted, with write access to real accounts. The two threats
that matter are prompt injection through fetched content and an over-broad
grant.

**Fetched content is data.** Every read verb that returns external text marks
its run tainted. Any action proposed by a tainted run carries
`derived_from_external = true` and can never auto-approve, whatever its risk
class. This does not happen by itself: the executor sets the flag, and a test
proves an action derived from a fetched message reaches `pending` rather than
`approved`.

**Least privilege.** Every integration connected after v2 ships starts at
`none`; the three live before it were backfilled to `read` (4.3). Grants are
per verb.

**Egress.** There is no runner-level network policy on Vercel Hobby, so the
draft's egress allowlist is not implementable as written. What is implementable
is stronger per request: every outbound call from an integration client goes
through `core/fetching.ts`, which already refuses non-http schemes, resolves
and checks every DNS record rather than the first, pins the connection to the
address it checked, and re-checks every redirect hop. v2 adds the manifest's
`hosts` list as an allowlist inside that path. A client that calls `fetch`
directly fails a test that greps for it.

**No work adjacent systems.** Employer accounts, work email, and anything
touching cleared work stay out of the integration registry. This is a rule, not
a preference, and it is why Gmail is a personal account only.

**The audit trail is the control that makes the rest reviewable.** Read it
weekly for the first month.

## 10. Cost

The cap stays $10 a month, decided 2026-09-05 and reaffirmed 2026-09-14. Total
model spend across the build was a few dollars as of 2026-09-14. That is a
reading of `core.llm_calls` on one day, not a standing figure: re-read it
rather than quoting it.

The draft estimated "low tens of dollars per month" for the nightly suggestion
pass. That number does not survive arithmetic. At the prices in `core/llm.ts`
(Haiku 4.5, $1 per million input, $5 per million output), a nightly pass of
30,000 input and 2,000 output tokens is about 4 cents, or $1.20 a month. Even
ten times that fits the cap. The estimate is replaced by the measurement:
`core.llm_calls` records every call from the first run, and the suggestion pass
is a capped purpose, so it stops rather than overruns.

Three tiers, unchanged from the draft and already how this system works:

| Tier | Used for | Cost |
|---|---|---|
| Rules | Classification, filtering, routing | Free |
| Haiku | Suggestion pass, preview text, summaries | Low |
| Sonnet | Plan generation, explicit owner requests | On demand |

Controls: event driven over polling, one nightly sweep, `cacheTtl` per verb so
a mailbox is not re-pulled to answer one question, per-run budgets as the hard
stop, and the running month total on the dashboard where it already is.

## 11. Templateability and demo mode

Most of this shipped with v1. What is left:

- A pre-commit check that fails on personal data in the repo. Not built.
- Demo mode: a flag routing every integration verb to a stub returning fixture
  data, so the system can be shown without exposing real mail or finances. The
  stub only has to satisfy the verb signature, which is why this is cheap.
  `pnpm setup:demo` already seeds the rows; this adds the integration half.

Fixtures are fictional, not scrubbed real data. Scrubbing is a process that
fails quietly once.

## 12. Build order

Eleven phases, numbered 0 to 10. Phases 0 to 4 are the product: stopping
there leaves an agent doing real work on real accounts under approval.
Everything after increases what it can do without changing whether it is safe.

No write verb exists before phase 6: SimpleFIN, the vault and Strava are all
read, and Apple Health is inbound. So phases 1, 2 and 4 cannot prove their done
conditions against a real provider. Phase 1 adds `integrations/fixture/`, an
integration whose client writes to a table in its own schema rather than to
the network, with one read verb and one write verb at each of low, medium and
high risk. Every
ledger, auto-approve, taint and approval test runs against it, and phase 10's
demo mode is the same integration with fixture rows behind it. It ships in the
repo because a fork needs it for the same two reasons.

| Phase | Deliverable | Done when |
|---|---|---|
| 0 | Verbs, permission and the verb executor on the integrations already written | SimpleFIN, the vault and Strava declare verbs, carry a level, and reach the network only through `runVerb`; both Apple Health routes carry a level that gates their webhook, and declare no verbs because neither makes an outbound call (4.5). A level of `none` refuses a sync and the job says so. No new OAuth work. |
| 1 | Ledger extension, state machine, the fixture integration | An approved fixture write verb executes exactly once, and a duplicate idempotency key is rejected by Postgres rather than by application code. |
| 2 | Auto-approve rules and taint | `risk = high` cannot be auto-approved and neither can an action derived from fetched content, both proven by failing-first tests. |
| 3 | Run budgets and the Postgres queue | A runaway run terminates on each of the three budgets and records `termination_reason`. |
| 4 | Approval surface and push | An approval from the phone executes the action and the Agent Log shows it. |
| 5 | Gmail at `read`, one label | Real mail fetched from the POS label, `cacheTtl` honoured, every message treated as tainted input. |
| 6 | Google Calendar and GitHub at `propose` | Each executes one approved write verb end to end. |
| 7 | Facts and forget | Facts extracted, and a tombstoned fact verified not to reappear after a full re-extraction. |
| 8 | Nightly suggestion pass | Suggestions appear in Review, dismissal suppresses the class, three dismissals disable it. |
| 9 | Plans in the goals schema | One goal produces a versioned plan with mixed task and action steps, and an invalidating event marks it stale. |
| 10 | Demo mode, persona, template check | A clean clone runs on the fixture integration with zero credentials configured. |

## 13. Verification checklist

Before v2 is considered shipped:

- [ ] No agent-initiated external side effect occurs without a `core.proposals`
      row that passed through state `approved`. UI writes to the owner's own
      database are excluded by design and are not external.
- [ ] A duplicate idempotency key is rejected at the database level
- [ ] Revoking a credential cancels pending approved actions and deletes the
      verb grants, in one transaction
- [ ] An expired approval cannot execute, checked at execution time
- [ ] `risk = high` cannot be auto-approved, verified by test
- [ ] An action derived from fetched content cannot auto-approve, verified by test
- [ ] Every executed action emits to `core.events` and respects `is_manual`
- [ ] A run exceeding any of the three budgets terminates and records
      `termination_reason`
- [ ] A tombstoned fact does not reappear after a full re-extraction
- [ ] An integration that declares verbs cannot reach the network except
      through `runVerb`, verified by test
- [ ] A nightly sync at level `none` refuses, records why, and the run
      continues
- [ ] A write verb from a job source cannot execute without an approval or a
      matching rule
- [ ] A clean clone runs in demo mode with zero credentials configured

## 14. Gmail, decided 2026-09-14

Researched before phase 5 was scheduled, because the answer could have made it
a different phase. Google's own documentation domains are blocked by the
session's egress proxy, so every claim here came from secondary sources and is
marked verify until checked on the console.

**Scope: `gmail.readonly`.** It is a restricted scope. A verified app using one
needs a CASA third-party security assessment revalidated every 12 months, at a
few hundred to a few thousand dollars a year. POS never enters that path: an
unverified app under 100 users keeps working, and the owner clicks through the
unverified screen once. Verify.

**Publishing status: In production, verification not submitted.** This is the
setting that matters and it is easy to get wrong. A project left at Testing
expires every refresh token after 7 days, which would break the nightly sync
within a week of connecting and read as a credential bug. Verify.

**The 100-user cap is per project and permanent.** Irrelevant at one user. It
would be fatal to a hosted multi-tenant POS, which v2 is explicitly not, and it
does not touch the self-host template: a fork registers its own Google project.

**One label, not the mailbox.** The Gmail connector lists only messages
carrying a label the owner files into. Said precisely, because the weaker
version of this claim is the tempting one: `gmail.readonly` grants read on the
whole mailbox and Google enforces no label restriction on the token. The limit
lives in the client's query and nowhere else. What it buys is real but narrower
than it sounds: less mail through the model, a smaller injection surface, and a
filing decision that belongs to the owner rather than to a heuristic. It is not
containment of the credential.

A future write verb does not raise the tier: `gmail.modify` is restricted too,
so the assessment question is answered the same way. `gmail.metadata` is
restricted as well and returns headers only, so it is not a cheaper substitute.
Verify both.

## 15. Open decisions for v2

None. The two open on 2026-09-14 are resolved above:
Gmail reads one label at `gmail.readonly`, and `core.auto_approve_rules` ships
empty.

Shipping that table empty is the decision most likely to be revisited, which is
the point of it. Four weeks of manual approval produce a list of what was
approved every time without hesitation, and rules written against that list are
evidence. Rules written now would be a guess about which verbs feel safe before
one has ever run.
