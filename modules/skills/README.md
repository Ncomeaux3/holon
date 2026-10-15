# Skill Tree

The character sheet. Every event any module writes links to a skill and
contributes XP; this module owns the tree, the weights, and the screen.

It is also the module core classifies through. `core/entities.register()` asks
the registry which module declares a `classifier` and calls it. Delete this
folder and the app still runs: entities register, events emit, nothing
classifies.

## Layout

| Path | Purpose |
|---|---|
| `manifest.ts` | Registration, plus `classifier: classify` |
| `skills.yaml` | The committed tree. Generic on purpose |
| `xp.yaml` | XP per event type |
| `tree.ts` | `skills.yaml` merged with `skills.override` |
| `classify.ts` | Rules first, model second. Writes `core.skill_links` |
| `xp.ts` | `level()`, mirrored by `skills.level()` in SQL |
| `data.ts` | Everything the screen needs, in two queries |
| `ui/layout.ts` | Deterministic constellation placement. No d3-force |
| `pressure.ts` | Which goal-linked skills have gone quiet; shared by the page and the digest |
| `jobs/nightly-digest.ts` | Attribute levels, gaining, stagnant, under goal pressure |

## Schema

| Object | What it is |
|---|---|
| `skills.xp_weight` | Seeded from `xp.yaml` by `pnpm setup` |
| `skills.override` | The owner's edits: custom, rename, delete |
| `skills.level(int)` | `min(99, floor(sqrt(xp / 100)))` |
| `skills.xp` | View over `core.events` and `core.skill_links` |

`core.skill_links` stays in core. It is the table every module writes through
`register()`, not a skills table that happens to live there.

## The tree

`skills.yaml` is the fork default and holds nothing personal. Every edit the
owner makes is a row in `skills.override`, which is also why the tree is
editable on Vercel, where the filesystem is read only at runtime. Resetting to
the default is a delete of every row.

Deleting a parent takes its descendants with it. Leaving them would put orphans
in the tree that no view can place and no XP can roll up.

## Tools

| Tool | Guarded | Notes |
|---|---|---|
| `skills.get_digest` | no | Attribute levels, character level, gaining, stagnant, under goal pressure |
| `skills.write` | no | Add, rename or delete a skill |
| `skills.reassign` | no | Move a link by hand. Sets `is_manual` |
| `skills.link` | no | Add a link by hand from any entity drawer's picker. Same row as a reassign; clears a parked `unclassified` |
| `skills.unlink` | no | Remove one link. Leaves nothing in its place |
| `skills.query` | no | Provided by core, scoped to `skills` and `core` |

## XP

`level = min(99, floor(sqrt(xp / 100)))`, so 100 XP is level 1, 2500 is level 5,
10000 is level 10. The formula lives twice, in `xp.ts` and in `skills.level()`,
and `xp.test.ts` proves the two agree on twenty values.

A parent's XP is the sum of its children, rolled up in TypeScript rather than in
SQL: the tree shape lives in the yaml and the overrides table, so there is no
parent column in the database to recurse over.

## Known gaps

- **Goal weight shows `--`.** The prototype's right rail has a goal weight per
  skill. Nothing supplies one until the Goals module ships.
- **No Notion backfill.** XP starts at zero by decision, 2026-09-08. Tasks and
  Second Brain import their own history later, which is where the events are.
