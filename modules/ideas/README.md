# Ideas

Effort against impact, four stages, and a graveyard that is kept. Screen 17 of
the design bundle.

## Three points, not ten

`effort` and `impact` are 1 to 3. A ten point scale invites a precision nobody
has: the difference between a six and a seven is not a judgement anyone makes
the same way twice, and two sittings a week apart would score the same idea
differently for no reason. Cheap, middling, expensive is a judgement a person
can actually repeat.

The quadrant falls out of the two scores rather than being stored, so it can
never disagree with them. `quadrant.ts` is the whole rule and it is tested.

## A killed idea is kept

`stage = 'killed'` with a `killed_reason`, never a delete. The reason is the
most useful note about an idea: it is what stops the same one arriving again in
six months and getting the same two evenings spent on it.

The killed tab is a first class view for that reason, not a bin.

## Not moving is named, not decided

An exploring idea untouched for sixty days shows in the "not moving" card with
a Kill it button next to it. The card says how long, and offers the choice. It
does not make it. An idea that goes quiet for two months is usually dead, but
usually is not always, and the module has no way to tell which this is.

Staleness reads `updated_at`, so the trigger on this table stamps the time only
when the writer did not set it. That lets the demo seed back-date a row, and it
means a re-seed does not quietly make every idea look fresh.

## The goal link goes through core

`goal_ref` points at `core.entities`, not at `goals.goal`. So an idea can name
the goal it serves before the Goals module is installed, and nothing here
changes when it lands.

## Nothing is guarded

Capturing, scoring and moving an idea are all reversible by doing the opposite,
and none of it spends money or makes a commitment. Killing one keeps the row.

## Research is the only thing here that spends money

`research` is the module's one guarded tool. Capturing, scoring and killing an
idea are free and reversible; a research run is neither. A quick run is up to
four searches and a deep one twelve, at a cent each, and the pages those
searches return are read as tokens, which is the larger half of the bill. A
measured quick run came to about twenty cents.

The owner pressing the button is the approval. An agent asking lands in the
Review inbox, because an agent that decided to research forty ideas one night
would be inside the monthly cap and still wrong.

Research is a capped purpose, so the soft cap in Settings stops it first when
the month runs out. That is deliberate: classification keeps the system working
and research is the optional part.

## A number with no source is deleted before you see it

SPEC's rule, enforced rather than requested. The model is asked for JSON with a
source URL on every claim, and `keepSourced` drops any numeric claim whose URL
is not one the search actually returned. Two failures that catches:

- a number with no URL at all
- a URL the model produced from memory, which looks exactly like a citation

Prose is held to the same rule: a number smuggled into a section summary is
still a number nobody can check, so the summary is dropped instead.

An opinion with no source is kept. Opinion is allowed; it just cannot wear
numbers it did not earn.

`unclear` is a real verdict and the default. A rubric that always reaches build,
park or drop is guessing on the runs where the evidence was thin, and thin
evidence is the normal case for an idea somebody wrote down on a walk.

A failed run is stored too, with its reason. Without that the screen cannot tell
"never researched" from "tried, and the account was out of credit".
