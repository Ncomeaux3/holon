# Calendar

One calendar of everything dated in POS, and a home for events that have no
other module. v1.2 phase 6a.

## The rows are the other modules'

Almost nothing on this screen is stored here. Tasks, Goals, Travel, Insurance,
Home, Health, Meals, Finance and Fitness each answer the manifest's
`calendar(range)` seam with their own dated rows, and
`core/calendar-registry.ts` puts them together. The Calendar reads no module
schema, the same split as the Weekly Review's `review` seam. A module that is
deleted drops off the screen and nothing here changes.

What each module sends is in its own `calendar.ts`, with a test beside it:

| Module | On the calendar | Links to |
|---|---|---|
| Tasks | due date, with its time; done ones muted | the task's drawer |
| Goals | deadline | Goals |
| Travel | each day of a trip, and itinerary items on their day | the trip |
| Insurance | the day an active policy expires | the policy |
| Home | service due dates, projected forward by the interval | the asset |
| Health | appointments with their time, medication refill dates | Health |
| Meals | plan entries, labelled by slot | Meals |
| Finance | recurring charges, projected forward by cadence | Subscriptions |
| Fitness | logged workouts, as done | Fitness |

Links to a module root become drawer links in v1.2 Phase 13.

## What this module stores

`calendar.event` holds events typed here (`source = 'manual'`, or `agent`
through MCP) and, from Phases 7a and 7b, read-only events from Google and
iCloud (`google`, `ics`), upserted on `(source, external_id)`. Only a typed
event can be edited or deleted; a feed's rows are the feed's, and the next
pull would overwrite an edit.

Google (Phase 7a) arrives through the `pull_google` job: a full window each
run, 30 days back to 365 ahead, from the calendars picked on the Google card in
Settings > Connections. The Sync band shows on this screen once Google is
connected; the module has no `requires`, because without Google it is still
complete from the other modules. Setup: docs/SETUP-INTEGRATIONS.md, Google.

Published calendars (Phase 7b) arrive through the `pull_ics` job, the same
window and the same delete-what-is-gone rule, from the URLs saved on the
iCloud card. `integrations/ics/client.ts` holds the parser, which reads plain
`.ics` with no dependency; what it expands and what it does not is written down
there and in docs/SETUP-INTEGRATIONS.md. Rows are keyed
`<hash of the URL>/<uid>`, so two calendars never collide and a removed URL's
rows are found again. Both pulls write through `jobs/feed.ts`, which is the
one place a feed's window is upserted and diffed.

Times are the owner's wall clock and are turned into instants in SQL in the
owner's zone, so the server's zone (UTC on Vercel) never enters it.

`calendar.settings` is one row holding the modules the owner switched off with
the chips. It follows the owner between phone and desktop.

Events are not registered in `core.entities`: `register()` classifies every row
to skills, and a feed's hundreds of meetings would each take a classifier pass
for nothing an appointment could earn.

## Tools

- `get_digest`: counts for today and tomorrow and the next three things, across
  every module the owner has not switched off.
- `write_event`, `delete_event`: typed events only.
- `set_hidden`: the modules the screen leaves out.
