# Second Brain

Schema `brain`, not `second_brain` (decision 14). Screen 08 of the design
bundle.

## Capture first

One box above the list, no title field: the first line is the title, because
that is what gets written first anyway. A bare URL goes through `ingest`; a
"worked on" tick files the text as a `daily`. While typing, `relatedToText`
runs `search()` over the module once per pause, words first and a Voyage
query only when words find nothing, so an old note comes back at the moment
a new one is about the same thing. That is the one resurfacing mechanism;
there is no weekly email and no per-note summary.

A file (PDF, JPEG, PNG, GIF or WebP, up to 10 MB) is a note with `file_path`
set: the name is the title and one Haiku call transcribes it into the body,
so it files and searches like typed text. The bytes sit in the private
`brain` bucket behind a signed URL. When the spend cap or a missing key stops
the call the body reads "Transcription pending" and the nightly
`file_unfiled` job retries one such file a night.

## Hubs are groupings

A hub is a name and keywords, made in the band. A note sits in as many hubs
as match, which is why a hub is not a folder. `fileByRules` runs at capture
and on pull; `file_unfiled` catches the misses nightly with one Haiku call
for every unfiled note; a tick on the note is manual and is never overwritten.
No hub is made by the model, and no hub has model prose.

## The review step is a column

SPEC's promise is that the vault is the source of truth and the app never adds
to it without a review step. That promise is `note.status`.

An ingested note is a **draft**: a proposal about a note, not a note. It sits in
the inbox beside the text it was drawn from until the owner accepts it. `write`
called with `source: 'agent'` produces a draft whatever it asks for, and
`publish` is reached from the inbox, so an agent cannot put anything in the
vault by any path.

That is also why almost nothing in this module is guarded. The draft state
already is the guard, and guarding on top of it would put one decision behind
two approvals. The two exceptions are `ingest`, which spends money, and
`delete`, which removes.

Accepting a book or an article is finishing it (decision 2026-09-11): adding one
here means it was read, so `publish` emits `book_finished` or `article_read`
beside `note_approved`, and the Reading list shows the accepted date on each.
There is no separate finished state.

The source text is stored and shown **beside** the summary, not behind a
disclosure. A draft is judged against what it was drawn from, not taken on
trust.

## Links

`wikilinks.ts`, tested, because getting it wrong does not throw. It quietly
loses the connection between two notes, which is the one thing a second brain
exists to keep.

Three cases the test pins that a naive regex gets wrong:

**Code is not prose.** A note about this parser would link to itself, and a code
sample containing `[[x]]` would create a note nobody asked for. Fenced and
inline code are masked before matching, with spaces rather than deletion so
every offset outside the code is unchanged.

**A piped link points at its target, not its label.** `[[slug|what to show]]` is
standard vault syntax, and linking to the label points at a note that does not
exist.

**A slug is never empty.** An empty slug collides with every other empty slug on
the unique index, so the first untitled note would save and the second would
fail with a constraint error nobody could read. It falls back to `untitled`.

Slugs are stable once set. Renaming a note keeps its slug, because every link
pointing at it was written against the old one, and rewriting other notes to
suit a rename is not something this app gets to do.

## Unresolved links are kept

`brain.link` stores a link whose target does not exist, with a null
`to_note_id`.

That is the most useful backlog in the app: each one is a note the vault is
already asking for. The screen lists them under "links with nothing behind
them" and offers to start each one. Dropping them, which is what deriving links
on read would do, would lose exactly the thing worth keeping.

`resolveDanglingLinks()` runs when a note is created, so writing the note
someone linked to last week connects the two without either being edited. The
nightly `resolve_links` job does the same sweep, because a note created through
MCP or an import never touches the UI path.

## The vault is pulled, never pushed

`jobs/pull-vault.ts` mirrors the Obsidian vault in one direction. A file that
changed rewrites its note; nothing here can write to the vault, because
`integrations/github_vault/client.ts` has no function that could.

A pulled note is **published**, not a draft. It is already in the vault, so it
is already the owner's. The draft state exists for the other direction: things
the app proposes to add.

Three decisions worth knowing:

**A blob sha is the change detector.** Git already hashes every file, so an
unchanged sha means an unchanged file and there is no read and no write. A
nightly pull over a settled vault costs one request. Nothing needed a content
hash column because git had already computed one.

**The backfill emits nothing.** `register()` is called with `emit: false`, so
notes register for search and skills without emitting a creation event.
Hundreds of notes written over years are not hundreds of notes of work
tonight, and awarding them today's XP would spike the Skill Tree for one
evening and leave it wrong forever.

**A file that has gone is not a note that has gone.** Orphans are counted and
reported, never deleted. A rename, a move, or a mistake should not silently
remove a note, and the vault is a git repo so the app is not the last copy
either way.

`external_id` is the vault path, so `unique (source, external_id)` keys a note
to its file. Slugs come from the file **name** rather than the path, because
that is how Obsidian resolves `[[DDIA]]` to `Books/Distributed/DDIA.md`.

## Ingestion

`ingest.ts`. Paste a URL on the inbox and a draft arrives: readable text out of
the page, a transcript out of a YouTube link, and a summary the model drafts
from whichever it got. The source is stored beside the summary, as every draft's
is, so it is judged against what it was drawn from.

**It is guarded, with `delete`.** Everything else here is unguarded because the
draft state already is the review step. Ingest is
different for the reason Ideas guards research: it spends money on every call,
and the draft state does not guard against that. An agent that decided to read
forty links one night would be inside the monthly cap and still wrong. The owner
pasting a URL is the approval; an agent asking lands in Review.

**It always drafts, even for the owner.** Every other write tool publishes for
the owner and drafts for an agent. This one drafts for everyone, because the
body is something a model wrote and that is exactly what the inbox is for.

**A page with almost no text in it is refused rather than summarised.** A
paywall stub, a cookie wall and a page that renders in the browser all look the
same from here, and a confident summary of an article nobody read is the worst
thing this feature could do.

### The outbound trust boundary is its own file

`core/fetching.ts` (moved out of this module on 2026-09-11 so Meals can import a recipe page through the same check). Ingest takes a URL from a server action, and a server action is
a public POST endpoint, so everything deciding whether a request may leave the
deployment lives in one place that knows nothing about notes.

**`fetch` is not used, and that is the point.** Node's `fetch` cannot pin a
connection to an address. Without pinning the hostname is resolved once for the
check and again for the connection, and a record with a one second TTL fits
through the gap between them. `node:https` accepts a `lookup`, so the address
that was checked is the address that is dialled. `pinnedLookup` ignores the
hostname it is handed and answers with the already-checked addresses; there is
a test that runs a real server and proves node honours it, because without that
the whole design rests on an assumption.

The Host header and the TLS server name still come from the hostname, so
virtual hosting and certificate validation are unaffected.

**Every hop of a redirect is checked.** An automated review caught this after
the first version shipped, and it was right: `redirect: 'follow'` validated the
pasted link and then chased a `302` anywhere, so a page under someone else's
control could answer `Location: http://169.254.169.254/latest/meta-data/` and be
fetched from inside the deployment with the guard already satisfied. No DNS
control needed, which made it easier than the attack the guard was written for.
`follow` takes its fetcher as a parameter so the loop is testable without
loosening any check to let a test through.

**Every resolved record is checked, not the first.** One private answer among
several is still a way in, and which address a connection picks is not ours to
predict.

Three layers, and each has the test that fails if it goes: the literal address
rules, the resolve-and-check, and the pin that makes the second one hold.

**The summary is capped.** It is Haiku, about half a cent, and it counts against
the same monthly cap research does. Reaching the cap does not break ingestion:
the draft still arrives with the full source text and a line saying why there is
no summary. Writing the note yourself is what a second brain is for.

### Extraction has no dependency, by decision

`extract.ts` is not Readability's algorithm and does not pretend to be. It drops
what is definitionally not prose, prefers the tag that says "this is the
article", turns block tags into line breaks and decodes entities. The bar is
lower than a library's because the extracted text is shown beside the draft: a
bad extraction is visible and correctable rather than silent.

Three things its tests pin, all of which the obvious version gets wrong:

- **`<[^>]+>` is not a tag.** `<a title="a > b">` ends that match early and
  leaves `b">` in the note as text.
- **Whitespace collapses before block tags become line breaks.** Otherwise a
  newline inside a paragraph splits it, and an article arrives one line per
  source line.
- **A hyphen is not a title separator.** "Postgres - what the planner actually
  does" is one headline, and treating the hyphen as a separator truncates it to
  one word. Pipes and en dashes are separators; hyphens are not.

### YouTube, and the deviation from SPEC

SPEC says yt-dlp. It is a Python binary and Vercel's Node runtime cannot run
one, so the choice was never between this and yt-dlp: it was between this and
nothing. `youtube.ts` reads the caption track list off the watch page and
fetches a track, which is what yt-dlp does for captions anyway.

The endpoint is undocumented and can change. Every parser in that file returns
nothing rather than throwing or guessing, and a video with no captions says so
instead of producing a note about a video nobody watched. A written track beats
an automatic one, and an automatic transcript is labelled as such on the draft.

### What is still missing

Book notes are still manual, which SPEC always said they would be. The other
direction, proposing a commit back to the vault, is not built: the client is
read only by construction and there is no write path to propose through yet.

## Backlinks are a table, not a query

The panel asks the reverse question, and scanning every body for a title is the
one query here that would not scale. A row per direction, rewritten on save.
