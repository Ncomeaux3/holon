# Home and assets

The house, the vehicles and the equipment worth tracking. Screen 18 of the
design bundle.

## The calendar is derived, never stored

A service is an interval plus the date it was last done. Nothing stores a list
of future dates.

A row of dates goes stale the moment a job happens early or late, and
reconciling it means either rewriting the future or living with a calendar that
disagrees with the history. Interval plus last done can only be wrong about one
thing at a time, and `next12Months` works the year out on read.

`due_on` is the one exception, and it wins over the interval: it is what the
shop or the council actually said, and the interval is only a guess at the same
thing. Logging the work clears it, so an override cannot outlive the job it was
for.

## Marking done writes history

The Mark done button goes through `log_service` rather than setting
`last_done_on` directly, so a job ticked off the calendar leaves the same row as
one typed in by hand. A schedule that moved with no record behind it would be
the calendar quietly disagreeing with the log.

Logging a job that is already scheduled moves that row rather than adding a
second one beside it. Two schedules called "gutter clean" on one house would
double the year's estimate and nag twice.

## A snooze comes back

Snoozing sets a date, and there is no button anywhere here that makes a job
disappear for good. A gutter clean you decided against in October is still a
gutter clean.

The weekly review asks about overdue service for the same reason: it is the
kind of miss that costs money quietly. Carrying moves the date; dropping
snoozes for a month.

## Nothing is valued for you

`value_cents` and `annual_cost_cents` are the owner's own figures, typed in.
Nothing in this module fetches a valuation. There is no free API that would be
right about this house, and a wrong number carried into net worth is worse than
no number at all, so the screen labels the total "your own estimate".

Cost on a logged job is nullable. Null means the receipt is not to hand, which
is a different claim from free, and zero would have made those two the same.

## The mortgage lives in Finance

The property card shows facts the owner keeps here, and says where the rest is:
the mortgage and escrow in Finance, cover in Insurance. Read through the metric
registry rather than copied, so there is one number and it is current. With
neither module installed the card says so instead of showing a stale figure.

## What is guarded

`write_asset` only. What an asset is worth is a claim about money and an agent
revising it belongs in the Review inbox. Logging a service, scheduling the next
one and snoozing a nag are records or reminders, and an approval step would
fill the inbox with rows whose only answer is yes.

## Typed in the app

Assets, scheduled jobs and warranties each have a form. Add asset and Edit (with Archive) go through
`write_asset`; Schedule service and Edit on a month row (with Stop scheduling)
through `schedule_service`; Add warranty and Edit through `write_warranty`. A
write from the screen is never guarded, so an asset saved here lands at once;
the same tool called by an agent still waits in Review.

Schedule service always asks when the job is next due and stores it as
`due_on`. A job that has never been done has no last date to count an interval
from, so without one it would never reach the calendar. Logging the job clears
the date and the interval takes over.

Log service opens filled in from an asset's drawer and from a month row's Log
button, and a job opened that way is the one it rolls forward. Vendors have no
form yet.
