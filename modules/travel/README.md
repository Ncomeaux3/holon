# Travel

Trips, what they cost, where you have been, and the one calculation SPEC asks
for. Screen 13 of the design bundle.

## The globe is hand rolled

The plan budgeted for `d3-geo`, `topojson-client` and a world-atlas file, which
together buy country outlines and cost about 100kB of download.

`globe.ts` is an orthographic projection, tested, with nothing imported. The
land is `land.json`: the Natural Earth 110m country polygons as rings, decoded
once by `scripts/land-rings.mts` and committed (285 rings, about 130kB before
gzip). `ringPath` fills each ring and cuts it at the horizon, joining the cuts
with an arc along the rim; `landPath` is one SVG path for all of them, drawn
with the even-odd rule so lakes and enclaves are holes. `project()` is exactly
the function d3 would be replacing, and the note in that file says so.

Two things the test pins that are easy to get wrong:

**Visibility.** A point on the far side of the sphere must not be drawn, or the
back of the world shows through the front. The test uses the exact silhouette
as a case, because a point at `z = 0` that flickered would be worse than one
consistently on either side.

**Line breaking.** A grid line that passes behind the globe is broken rather
than joined. Connecting where it disappears to where it returns draws a chord
straight through the middle, which is the single artefact that makes a
wireframe look broken rather than sparse. It only happens when the rotation puts
the antimeridian in view, which is what the test rotates to.

## Cents per point

`centsPerPoint(cash, points, fees)`. Both numbers come from the owner.

SPEC is explicit that loyalty sites are not scraped, so nothing here knows what
a point is worth and nothing pretends to. The screen offers 1.5 cents as a rule
of thumb and is clear that the answer is only as good as the two numbers put in.

Loyalty balances are typed by hand, and the row shows when **you** last updated
it rather than implying anything fetched it.

## Two review gates, same shape

A booking parsed from an email arrives as `status = 'pending'` with a
confidence, and waits in the inbox. A machine reading a confirmation is
proposing, not deciding; this is the same shape as the Second Brain draft and
the Tasks review column, for the same reason.

Only **confirmed** spend counts against a trip budget. A pending booking is a
guess about an email, and a budget moved by a guess is a number that stops being
trusted.

That is also why `write_item` is unguarded while `write_trip` is guarded: an
agent-added item already lands in the inbox, so guarding it too would put one
decision behind two approvals. A trip is a commitment with a budget attached.

## Budget, planned, spent (v1.2 phase 10b)

A trip shows three numbers. Budget is typed. Planned is the confirmed
itinerary's amounts. Spent is the transactions Finance has tagged to the trip,
read through the `spend` seam (`core/modules.getSpend`), never a finance table.
Remaining is the budget less the larger of planned and spent, not their sum: a
booked hotel shows in both once its charge lands (`remaining()` in budget.ts).

Tagging is Finance's. `spend.ts` hands Finance the trip's destinations and
dates through `finance.tag_trip` on every trip save, after a merge, and nightly
(`tag_spend`, trips that ended in the last 90 days or have not ended). A loyalty
program names the card that earns it through `link_loyalty_account`, a Finance
account's registry row, and the drawer shows that card's charges last calendar
month beside the typed balance. Points earned are not computed.

## The itinerary is by day

`itinerary.ts` lists a trip's days and, for each, the destinations whose dates
cover it: two on the day you move on, so the header reads "Ghent → Bruges".
An item's own `place` overrides that, as free text, because the destinations
are deleted and rewritten on every trip save and a key to one would not
survive. An `idea` sits on its day beside what is confirmed and never counts as
spend; a `pending` one waits in the Inbox.

A reservation is a confirmed item with a provider, a code and, optionally, the
confirmation PDF or image in the private `travel` bucket under the trip's id.

Gmail (v1.2 phase 10a): an event whose date falls in a planned or booked trip
is written here as a pending item keyed by its Gmail link, and does not also
reach Review. The trip's Inbox is the one approval, and only the owner can
accept there. A rejected or removed emailed item stays as `dismissed`, never
drawn, so the same email is not written again the next night.

## Places outlive trips

`place_visited` is its own table, and `complete_trips` writes one when a booked
trip's end date passes. The map is a record of where you have been, and it
should not empty out because a trip was archived.

A past trip with no place of its own still pins, in grey, from its own
destinations or its own coordinates. Only a `booked` trip reaches
`complete_trips`, so a trip marked done by hand and one left `planned` past its
end date have no `place_visited` row and used to be in the Past list and nowhere
on the globe. A trip a place already points at is left to that place, so a
completed trip pins once. See `ui/pins.ts`.
