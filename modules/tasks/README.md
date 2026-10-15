# Tasks

Six views over one list, plus a month grid. Screen 05 of the design bundle.

## Schema

`tasks.project` is a folder. `tasks.task` is the work.

Two things about the columns are worth knowing before you add to them:

**`due_on` is a date, `due_at` is a time, and they are separate.** "Due
Thursday" is a day. Storing it as a timestamp makes it wrong for anyone who
crosses a timezone, and most tasks have no time of day at all.

**`goal_ref` points at `core.entities`, not at a goals table.** Cross-module
links go through the core registry, which is what it is for. That is why this
module shipped before Goals did and will need nothing changed when Goals lands:
the goal picker is empty today and fills in on its own.

`status` has three values. `review` is a real row that does not count as work
until the owner accepts it, which is what an agent-created task is.

**A repeating task is one row at a time.** `repeat` holds the rule
(`{ every, on?, interval? }`, walked by `repeat.ts`). Completing the task, or
dropping it in the weekly review, writes the next instance with the next due
date past both the old one and today; the done row keeps its rule for
history. `repeat_from` names the instance it came from and is unique, so
completing, reopening and completing again still leaves one successor. Later
dates are projected on the calendars, never written.

## Apple Reminders

`inbound.ts` writes the open reminders an iOS Shortcut posts, as tasks with
`source = 'apple_reminders'`, upserted on `(source, external_id)`. Apple owns
the fields it sends on those rows (title, notes, due, and the list as the
project); a post never touches the rest, so a priority, an estimate, a goal or
a hand-linked skill survives the sync. A field Apple leaves out keeps what is
here, which is the SPEC's "never overwrite a manual field": notes typed in POS
outlive a reminder that has none. Clearing a due date in Reminders therefore
does not clear it here.

A reminder missing from the posts for two days is completed here, emitting the
same `task_completed` event finishing it in the app would. The sweep keys on
`updated_at`, which the table's trigger writes on every upsert, and runs only
when a payload arrives, so a phone that stops posting closes nothing. Nothing
travels back: Apple has no Reminders API, so a task completed here leaves the
reminder standing.

## Gmail

`jobs/pull-gmail.ts` reads mail the owner labels `POS` in Gmail, the last 30
days of it, through the Google connection (`gmail.readonly`, one label, never
the mailbox). Each message becomes proposals in `core.proposals`, never a row:
`gmail-rules.ts` turns an attached or inline invite into `calendar.write_event`
proposals with no model call, and sends anything else to Haiku (purpose `mail`,
capped) for a title, kind, date, time, amount and place. The subject's kind
outranks the model's, an event without a date becomes a task, and a reply that
fails the zod check, a missing key or the cap leaves a task named for the
subject. The Gmail link is the proposal's `evidence`, which Review shows as
Open in Gmail and the job dedupes on, so a message is fetched and paid for once.
An approved task proposal runs `write` as the agent, so it lands in review.

## The owner's day

Every date question goes through `core.today()`, never `current_date`.

The database runs in UTC and the app server runs wherever it runs; the owner's
day comes from `core.settings.timezone`. Between 19:00 in Chicago and midnight
in UTC those are different dates, and a board that used one while its queries
used another put today's work in tomorrow's column. `core/today.ts` reads the
same function, so the page and the digest cannot disagree.

## Tools

| Tool | What it does |
|---|---|
| `get_digest` | Open counts, planned minutes, what was completed, the next five due |
| `write` | Create a task, or update one by passing its id |
| `write_project` | Create a project, or rename, link to a goal, or archive one by id |
| `complete` | Mark done or reopen. Completing emits `task_completed`, which is the XP, and writes a repeating task's next instance |
| `approve` | Accept an agent-proposed task out of review |

Nothing is guarded. An agent-created task already lands in `review`, which is
this module's own version of the same gate; guarding `write` as well would put
it behind two approvals.

`write` does not call `register()` on an update. `register()` emits the creation
event, and a task edited twice would award its XP twice.

## Jobs

`pull_gmail` is described above; it runs first so the digest counts its proposals.

`roll_forward` moves anything still open past its due date to today, once,
overnight. Only work that was never started and has no time of day: a task
pinned to 17:30 on Thursday meant that Thursday, and silently moving it would
erase the fact that it was missed. Every roll writes to `core.write_log` with
the day it came from, so the Agent Log can show it and put it back.

`nightly_digest` writes the counts to `core.digests`. Nothing outside this
module reads the `tasks` schema; the Dashboard tile reads the digest.

## The quick add line

`modules/tasks/quickadd.ts`, and it has no imports, because the add form is a
client component and anything reaching `core/db.ts` drags `pg` into the browser
bundle.

```
Pay the card bill !p1 #Finance @tomorrow 5m
```

`!p1` priority, `#project`, `@today @tomorrow @week @later @mon..@sun`, and an
estimate like `30m`, `45 min`, `2h`, `1.5h`.

Two rules it follows, both tested:

**A token it does not recognise stays in the title.** `#homme` is a typo, not an
instruction, and dropping the word on the strength of a guess loses it.

**An estimate has to be anchored to a unit.** `Read DDIA ch. 5` and
`Deadlift 385` keep their numbers.

Naming the current weekday means next week. `@tue` on a Tuesday is a task for
next Tuesday; `@today` is how you say today.

## Views

`modules/tasks/shape.ts` holds `columnsFor(view, tasks, context)` and its test.
The view is in the URL, so it survives a refresh and can be linked to.

Overdue is its own bucket for counting and its own colour on a card, but it sits
in Today on the board: something that slipped is today's problem. Undated work
sweeps into Later rather than disappearing, and both `By goal` and `By project`
always offer a "none" column for the same reason.

A column with no `drop` is read only, and says so by not taking a dragged card:
Done and Review are histories, not places to put things.
