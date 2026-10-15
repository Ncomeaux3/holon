# Health

Appointments, prescriptions, screenings, records and the care team. Screen 10 of
the design bundle.

One of the two modules the design introduces that SPEC does not describe, so the
schema comes from the backend handoff, with the corrections the build plan
lists: every table gains `created_at`, `updated_at`, `source` and `external_id`
with a unique on the pair, and there is no `health.digest`, because
`core.digests` already holds every module's.

## One departure from the handoff

It gives `health.vital` a `weight_g` metric, and `fitness.body_metric` already
stores body weight.

Two tables holding the same number is two sources of truth, and one of them is
always stale. So vitals here are **clinical readings only**: blood pressure,
lipids, glucose, thyroid. Body weight is read from Fitness through the metric
registry, and the tile says "from Fitness" rather than implying it lives here.
When that module is not installed the tile is simply absent, which is what the
registry returning null is for.

## It has no opinions

SPEC's rule for Insurance is that nothing analyses coverage: no gap analysis, no
adequacy scoring, no model judgement. The same applies here, more so.

This module records what was done and when. It does not say whether a number is
good, whether a screening matters for you, or what a result implies. Every
reading shows its `provenance`, lab or device or manual, because that is what
decides whether it is worth acting on, and it is a required column rather than a
nullable one.

`record.fields` is `jsonb` holding whatever the document carried, as written. A
lab panel has forty analytes and every provider names them differently; a schema
that tried to hold them all would be wrong for the next one.

## Screening states

`screening.ts`, tested. Five states, and **`never` is its own**.

A screening you have never had is a different conversation from one you are late
for. Folding them together would show it as decades overdue, inventing a history
that does not exist, and `never` is exactly the state worth a line in a digest.

Snoozing is not dismissing: `snooze_until` pushes it out and it comes back.
There is no way from the UI to make a screening go away permanently.

The label switches from days to months past sixty days, because "615 days
overdue" is a number nobody parses.

## The medication streak

Today being unmarked does **not** break a streak. It is not the end of the day,
and punishing an unmarked today at 9am would make the number useless every
morning. Yesterday missing does break it.

One mark per medication per day, by constraint. Pressing it twice is a
correction, not a second dose, and a schema that allowed both would make the
streak a lie.

## Guarded, and what is not

`write_appointment` is guarded: booking or cancelling on someone's behalf is
exactly what the Review inbox exists for.

Recording a lab result, ticking a pill and closing a screening are not. They are
records of things that already happened, and putting them behind an approval
would fill the inbox with rows whose only answer is yes.

`log_vital` does not call `register()`. A reading is not work, its XP weight is
zero, and the skill tree has no medical node, so classifying it would cost a
model call to file it nowhere.
