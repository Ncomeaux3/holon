# Goals

Progress against a deadline, grouped by life area. Screen 06 of the design
bundle.

## Where the thinking is

`modules/goals/progress.ts` and its test. The schema stores readings; every
judgement about them is arithmetic in that one file, so a rule can be changed
and re-verified without a migration.

Four statuses, and each carries the sentence that produced it. A colour on its
own is not an answer, and the accent measures 3.8:1 on dark, so it is never the
only carrier of meaning anyway.

| Status | Rule |
|---|---|
| `done` | The target is reached. Not available to a habit, see below |
| `stalled` | The value has not moved in 30 days |
| `at_risk` | The last 30 days ran below four fifths of the rate still needed |
| `on_track` | Everything else |

Two kinds get their own rule, because the general one is wrong for them:

**A habit is never done.** "Cook five nights a week" is something you keep
doing, so hitting the number this week is on track, not finished. It is judged
on this week alone: at the target, above 60 percent of it, or stopped. The test
caught this one; the first implementation happily marked a habit complete.

**A milestone has no pace to read.** It happened or it did not, so the only
signal is how close the deadline is.

## Two projections, not one

`projected30` and `projectedAll`, shown side by side and labelled.

They agree while a goal is steady and disagree exactly when the answer matters:
a goal that stalled last month still looks fine on its lifetime average. Picking
one would be wrong quietly. `null` means "never at this pace", which the screen
prints rather than inventing a date.

The recent rate falls back to the oldest point when there are fewer than two
check-ins inside the window, or a goal that is clearly moving would measure
itself against itself and read as flat.

## The metric registry

A goal's `metric_source` is a key like `tasks.completed_this_week`, resolved
through `core/metrics.ts` against what modules put on their manifest.

This is the whole cross-module read mechanism for a live value. Goals never
parses a query string and never issues SQL against another schema. The picker
enumerates what is registered, so it offers exactly what some module will
actually compute.

Deleting a module makes its key stop resolving. `readMetric` returns null, the
goal falls back to its own check-ins, and the drawer says the source is gone.
That is what keeps `rm -r modules/tasks` from breaking a goal that pointed at
it.

## Check-ins

One reading per goal per day, enforced by a unique constraint. A second on the
same day corrects the first rather than adding a point, because the pace
arithmetic would count it twice.

`is_manual` only ever goes true. The nightly `pull_metrics` job writes
`is_manual = false`, and the upsert ORs the flag, so a reading you typed is
never taken back by a computation.

## Tools

| Tool | What it does |
|---|---|
| `get_digest` | Counts by status, and the ones worth a look, worst first |
| `write` | Create or update. **Guarded** |
| `checkin` | Record where it stands. Emits `goal_reached` or `goal_checkin` |

`write` is guarded and `checkin` is not, deliberately. Changing a goal is
changing what you are aiming at, which an agent should propose. A check-in is a
reading rather than a decision, and the nightly metric pull would be unusable
behind an approval.
