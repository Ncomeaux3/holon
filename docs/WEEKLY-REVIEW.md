# Weekly review

Six steps, one set of answers, saved as you go. Screen 17 of the design bundle.

## Why it is a core screen with a module contract

The review's questions are "what slipped" and "where do the goals stand". Those
are Tasks and Goals concepts, and the first version of this page answered them
by querying `tasks.task` and `goals.goal` directly, which the architecture
forbids: core does not read module schemas.

The fix is a contribution on the manifest rather than a query in the page.

```ts
review: {
  slipped?: () => Promise<ReviewItem[]>   // needs a decision this week
  upcoming?: () => Promise<ReviewItem[]>  // could be next week
  pending?: () => Promise<ReviewCheck[]>  // needs a number from the owner
  apply?: (decisions: ReviewDecisions) => Promise<void>
}
```

A module hands over its own rows and gets its own decisions back. `core` names
no module anywhere in this screen. Tasks supplies `slipped`, `upcoming` and
`apply`; Goals supplies `pending` and `apply`. A fork that deletes both gets a
review with a glance and a note, which still closes.

Step one is different: it reads `core.digests` through `latestDigests()`, picks
out the keys it recognises, and ignores the rest. Adding a module adds no code
here until someone decides one of its numbers belongs on the screen.

## The close is not a transaction

Four writes on separate connections: the module decisions, the week note, and
the review row.

They cannot be one transaction. A module's `apply` and the note's `write` are
closures on manifests, running whatever SQL that module wants on its own pool,
and wrapping them would mean a transaction helper that every module had to
participate in for a screen that runs once a week.

So it is a best-effort sequence with the review row written **last**. A week
that says it closed is one whose other writes landed. Anything that did not
apply is collected and named in the toast, because a review that quietly
half-applied is worse than one that failed.

## Resumable

Every change writes `core.reviews.answers`, and the step is in the URL. A
review interrupted at step four comes back at step four with its answers.

That is also why the e2e seed clears `core.reviews`: the fixture has to start
from nothing, or the previous run's answers are loaded back and added to.

## The note

Built by `renderNote()` in `core/reviews-shape.ts`, which has no imports and a
test. It is rendered on the close step **before** it is written, so nothing is
generated on the server that the owner has not already seen.

It goes to whichever module takes notes, resolved by `noteWriter()`: `brain`
first, then `notes`. Neither installed means the write-up stays on the review
row and the close says so. `core.reviews.note_ref` points at `core.entities`
rather than at the module row, so the link survives the note module being
swapped out.
