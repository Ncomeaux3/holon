// Nothing to seed.
//
// Skills are not entities: a skill is what an entity links to. The tree itself
// is committed in skills.yaml, and the only other rows this module owns are the
// owner's own edits in skills.override, which a demo has no business writing
// into. There is no `source` column to tell a demo override from a real one, so
// seeding one would leave a fake skill in the tree that `pnpm setup:demo` could
// not later tell apart from Nick's own.
//
// XP arrives from whatever the other modules seed, through register(). A fresh
// demo therefore shows a tree at level zero, which is what it should show.
export async function seed(): Promise<number> {
  return 0
}
